import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedDomainError,
} from '@/shared/domain/errors/domain.error';
import {
  applyPartnerTransition,
  type PartnerStatus,
  type PartnerVerificationAction,
} from '@/shared/domain/partner-verification';
import { applyOrderTransition } from '../domain/order-state-machine';
import {
  type ConfirmOutcome,
  MARKETPLACE_REPOSITORY,
  type MarketplaceRepository,
  type OrderRecord,
  type ProductRecord,
  type SellerRecord,
  type VariantRecord,
} from '../domain/ports/marketplace.repository';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/ports/payment-gateway';

export interface CheckoutResult {
  order: OrderRecord;
  /** Present only when there is a gateway leg to pay. Null for a fully-wallet-paid order. */
  gateway: { provider: string; keyId: string; gatewayOrderId: string; amountPaise: number } | null;
}

export interface WebhookResult {
  outcome: 'confirmed' | 'already_processed' | 'refunded' | 'ignored';
  orderId: string | null;
}

@Injectable()
export class MarketplaceUseCases {
  private readonly logger = new Logger(MarketplaceUseCases.name);
  private readonly currency: string;

  constructor(
    @Inject(MARKETPLACE_REPOSITORY) private readonly repo: MarketplaceRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.currency = this.config.get('PAYMENT_CURRENCY', { infer: true });
  }

  // ==========================================================================
  // Seller administration (OPS/SUPER_ADMIN)
  // ==========================================================================

  createSeller(input: {
    name: string;
    gstin: string | null;
    contactName: string;
    contactPhone: string;
    city: string;
    state: string;
  }): Promise<SellerRecord> {
    // Starts PENDING — a supplier is never verified by the act of being typed into a form.
    return this.repo.createSeller(input);
  }

  listSellers(status: PartnerStatus | null): Promise<SellerRecord[]> {
    return this.repo.listSellers(status);
  }

  async transitionSeller(input: {
    sellerId: string;
    action: PartnerVerificationAction;
    actorUserId: string;
  }): Promise<SellerRecord> {
    const seller = await this.repo.findSellerById(input.sellerId);
    if (seller === null) {
      throw new NotFoundError('Seller not found.');
    }

    // Reuses the SAME verification lifecycle as recycling partners — pure state machine.
    const nextStatus = applyPartnerTransition(seller.status, input.action);
    if (nextStatus === 'VERIFIED') {
      this.logger.log(`Seller ${input.sellerId} ${input.action} by ${input.actorUserId}`);
    }

    return this.repo.updateSellerStatus({
      id: input.sellerId,
      action: input.action,
      nextStatus,
      actorUserId: input.actorUserId,
    });
  }

  // ==========================================================================
  // Catalogue administration
  // ==========================================================================

  async createProduct(input: {
    sellerId: string;
    name: string;
    slug: string;
    description: string;
    recycledContent: string | null;
  }): Promise<ProductRecord> {
    const seller = await this.repo.findSellerById(input.sellerId);
    if (seller === null) {
      throw new NotFoundError('Seller not found.');
    }
    return this.repo.createProduct(input);
  }

  async setProductStatus(input: {
    productId: string;
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  }): Promise<ProductRecord> {
    const product = await this.repo.findProductById(input.productId);
    if (product === null) {
      throw new NotFoundError('Product not found.');
    }

    // A product cannot go ACTIVE while its seller is not VERIFIED, and it must have something
    // to sell — publishing an empty or priceless catalogue entry is a mistake, not an order.
    if (input.status === 'ACTIVE') {
      const seller = await this.repo.findSellerById(product.sellerId);
      if (seller?.status !== 'VERIFIED') {
        throw new ConflictError('The seller must be VERIFIED before its products can go live.');
      }
      if (product.variants.length === 0) {
        throw new ConflictError('Add at least one variant before activating the product.');
      }
    }

    return this.repo.setProductStatus(input.productId, input.status);
  }

  async createVariant(input: {
    productId: string;
    sku: string;
    name: string;
    pricePaise: number;
    stock: number;
  }): Promise<VariantRecord> {
    const product = await this.repo.findProductById(input.productId);
    if (product === null) {
      throw new NotFoundError('Product not found.');
    }
    return this.repo.createVariant(input);
  }

  updateVariant(input: {
    id: string;
    pricePaise?: number;
    stock?: number;
    isActive?: boolean;
  }): Promise<VariantRecord> {
    return this.repo.updateVariant(input);
  }

  // ==========================================================================
  // Catalogue (public browse)
  // ==========================================================================

  listProducts(): Promise<ProductRecord[]> {
    return this.repo.listActiveProducts();
  }

  async getProductBySlug(slug: string): Promise<ProductRecord> {
    const product = await this.repo.findActiveProductBySlug(slug);
    if (product === null) {
      throw new NotFoundError('Product not found.');
    }
    return product;
  }

  // ==========================================================================
  // Cart
  // ==========================================================================

  getCart(userId: string) {
    return this.repo.getCart(userId);
  }

  addToCart(input: { userId: string; variantId: string; quantity: number }) {
    return this.repo.addToCart(input);
  }

  setCartItemQuantity(input: { userId: string; variantId: string; quantity: number }) {
    return this.repo.setCartItemQuantity(input);
  }

  // ==========================================================================
  // Checkout
  // ==========================================================================

  /**
   * Turns the cart into an order and starts payment.
   *
   *  - Fully wallet-paid (gateway portion 0): confirmed SYNCHRONOUSLY here, in one atomic
   *    move — there is no external leg to wait on, so there is no reason to leave it pending.
   *  - Otherwise: a gateway order is opened for the remainder and returned to the client's
   *    checkout widget. The order stays PENDING_PAYMENT until the gateway's signed webhook
   *    confirms it. Inventory and the wallet are NOT touched until that confirmation.
   */
  async checkout(input: {
    userId: string;
    requestedWalletPaise: number;
    shippingAddressId: string | null;
  }): Promise<CheckoutResult> {
    const order = await this.repo.createPendingOrderFromCart(input);

    if (order.gatewayAmountPaise === 0) {
      const outcome = await this.repo.confirmWalletOnlyOrder({
        orderId: order.id,
        actorUserId: input.userId,
      });
      const confirmed = await this.settleWalletOnlyOutcome(outcome);
      return { order: confirmed, gateway: null };
    }

    let gatewayOrder;
    try {
      gatewayOrder = await this.gateway.createOrder({
        amountPaise: order.gatewayAmountPaise,
        currency: this.currency,
        receipt: order.id,
        notes: { orderId: order.id, userId: input.userId },
      });
    } catch (error) {
      // The gateway would not open an order — fail this one so it does not linger as a
      // pending order the customer cannot pay.
      await this.repo.failOrder({
        orderId: order.id,
        reason: 'Could not reach the payment gateway.',
      });
      throw error;
    }

    await this.repo.attachGatewayPayment({
      orderId: order.id,
      provider: this.gateway.provider,
      gatewayOrderId: gatewayOrder.gatewayOrderId,
      amountPaise: gatewayOrder.amountPaise,
    });

    const refreshed = (await this.repo.findOrderById(order.id)) ?? order;
    return {
      order: refreshed,
      gateway: {
        provider: this.gateway.provider,
        keyId: this.gateway.publicKeyId,
        gatewayOrderId: gatewayOrder.gatewayOrderId,
        amountPaise: gatewayOrder.amountPaise,
      },
    };
  }

  /** A wallet-only order has no gateway leg to refund; a failure just fails the order. */
  private async settleWalletOnlyOutcome(outcome: ConfirmOutcome): Promise<OrderRecord> {
    if (outcome.status === 'CONFIRMED' || outcome.status === 'ALREADY_RESOLVED') {
      return outcome.order;
    }

    const reason =
      outcome.status === 'INSUFFICIENT_STOCK'
        ? `One or more items sold out: ${outcome.detail}`
        : `Wallet balance changed: ${outcome.detail}`;
    await this.repo.failOrder({ orderId: outcome.order.id, reason });
    throw new ConflictError(reason);
  }

  // ==========================================================================
  // Webhook — gateway → us
  // ==========================================================================

  /**
   * Handles a gateway webhook. Verifies the signature over the RAW body (the one check
   * standing between confirmation and anyone on the internet), dedupes on the event id, and
   * — on a captured payment — confirms the order atomically. If confirmation cannot complete
   * (oversold, or the wallet balance moved), the captured money is REFUNDED: the compensating
   * action that keeps "wallet debit and gateway charge are one atomic outcome" true even
   * though the two legs commit at different times.
   */
  async handleWebhook(input: {
    rawBody: string;
    signature: string;
    eventId: string;
  }): Promise<WebhookResult> {
    if (!this.gateway.verifyWebhookSignature(input.rawBody, input.signature)) {
      // Not from the gateway (or tampered). Refuse — do not parse, do not act.
      throw new UnauthorizedWebhookError();
    }

    if (input.eventId.length === 0) {
      throw new ConflictError('Missing webhook event id.');
    }

    const event = this.gateway.parseWebhookEvent(input.rawBody);

    // We only act on a successful capture. Everything else (created, failed, authorized…) is
    // acknowledged and ignored — acting on them would confirm orders that were not paid.
    if (event.eventType !== 'payment.captured') {
      this.logger.debug(`Webhook ${event.eventType} acknowledged, no action.`);
      return { outcome: 'ignored', orderId: null };
    }

    if (event.gatewayOrderId === null || event.gatewayPaymentId === null) {
      throw new ConflictError('Capture webhook missing order or payment id.');
    }

    const outcome = await this.repo.confirmOrderFromWebhook({
      gatewayOrderId: event.gatewayOrderId,
      gatewayPaymentId: event.gatewayPaymentId,
      webhook: {
        provider: this.gateway.provider,
        eventId: input.eventId,
        eventType: event.eventType,
      },
    });

    switch (outcome.status) {
      case 'CONFIRMED':
        return { outcome: 'confirmed', orderId: outcome.order.id };
      case 'ALREADY_RESOLVED':
        return { outcome: 'already_processed', orderId: outcome.order.id };
      case 'INSUFFICIENT_STOCK':
      case 'INSUFFICIENT_WALLET':
        await this.refundAndFail(outcome, event.gatewayPaymentId);
        return { outcome: 'refunded', orderId: outcome.order.id };
    }
  }

  /**
   * The compensation: the gateway already captured the money, but the order could not be
   * confirmed. Fail the order and return the money. Both steps are idempotent (guarded by
   * order/payment status), so a webhook retry cannot double-refund.
   */
  private async refundAndFail(outcome: ConfirmOutcome, gatewayPaymentId: string): Promise<void> {
    const order = outcome.order;
    const reason =
      outcome.status === 'INSUFFICIENT_STOCK'
        ? `Sold out before payment cleared; refunded. ${'detail' in outcome ? outcome.detail : ''}`
        : `Wallet balance changed before payment cleared; refunded.`;

    await this.repo.failOrder({ orderId: order.id, reason });

    const refund = await this.gateway.refund({
      gatewayPaymentId,
      amountPaise: order.gatewayAmountPaise,
    });
    await this.repo.markPaymentRefunded({ orderId: order.id, refundId: refund.refundId });

    this.logger.warn(
      `Order ${order.id} failed post-capture and was refunded (${refund.refundId}).`,
    );
  }

  // ==========================================================================
  // Order reads & fulfilment
  // ==========================================================================

  listMyOrders(userId: string): Promise<OrderRecord[]> {
    return this.repo.listOrdersForUser(userId);
  }

  async getMyOrder(userId: string, orderId: string): Promise<OrderRecord> {
    const order = await this.repo.findOrderById(orderId);
    // 404 on someone else's order too — never confirm an id exists to a stranger.
    if (order?.userId !== userId) {
      throw new NotFoundError('Order not found.');
    }
    return order;
  }

  async advanceFulfilment(input: {
    orderId: string;
    action: 'SHIP' | 'DELIVER';
  }): Promise<OrderRecord> {
    const order = await this.repo.findOrderById(input.orderId);
    if (order === null) {
      throw new NotFoundError('Order not found.');
    }

    const nextStatus = applyOrderTransition(order.status, input.action);
    if (nextStatus !== 'SHIPPED' && nextStatus !== 'DELIVERED') {
      // Unreachable given the action set, but keeps the type honest.
      throw new ConflictError('Unsupported fulfilment transition.');
    }

    return this.repo.setOrderFulfilmentStatus({ orderId: input.orderId, nextStatus });
  }
}

/** A webhook whose signature did not verify. Mapped to 401 (not authenticated as the gateway). */
export class UnauthorizedWebhookError extends UnauthorizedDomainError {
  override readonly code = 'INVALID_WEBHOOK_SIGNATURE';

  constructor() {
    super('Webhook signature verification failed.');
  }
}
