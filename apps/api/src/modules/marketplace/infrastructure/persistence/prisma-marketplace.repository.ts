import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import {
  type PartnerStatus,
  type PartnerVerificationAction,
} from '@/shared/domain/partner-verification';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { InsufficientBalanceError } from '@/modules/wallet/domain/ledger';
import { WalletLedgerWriter } from '@/modules/wallet/infrastructure/persistence/wallet-ledger.writer';
import { OutOfStockError } from '../../domain/inventory';
import { applyOrderTransition, type OrderStatus } from '../../domain/order-state-machine';
import { calculateOrderTotals, splitPayment } from '../../domain/pricing';
import {
  type CartRecord,
  type ConfirmOutcome,
  type MarketplaceRepository,
  type OrderRecord,
  type ProductRecord,
  type SellerRecord,
  type VariantRecord,
} from '../../domain/ports/marketplace.repository';

type Tx = Prisma.TransactionClient;

/** What a locked order row exposes to the confirmation logic. */
interface LockedOrder {
  id: string;
  userId: string;
  status: OrderStatus;
  walletAppliedPaise: number;
  gatewayAmountPaise: number;
}

interface OrderLineForConfirm {
  variantId: string;
  sku: string;
  quantity: number;
}

@Injectable()
export class PrismaMarketplaceRepository implements MarketplaceRepository {
  private readonly logger = new Logger(PrismaMarketplaceRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerWriter,
  ) {}

  // ==========================================================================
  // Sellers
  // ==========================================================================

  async createSeller(input: {
    name: string;
    gstin: string | null;
    contactName: string;
    contactPhone: string;
    city: string;
    state: string;
  }): Promise<SellerRecord> {
    try {
      const row = await this.prisma.seller.create({ data: input });
      return toSeller(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A seller with that name already exists.');
      }
      throw error;
    }
  }

  async listSellers(status: PartnerStatus | null): Promise<SellerRecord[]> {
    const rows = await this.prisma.seller.findMany({
      where: status === null ? {} : { status },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSeller);
  }

  async findSellerById(id: string): Promise<SellerRecord | null> {
    const row = await this.prisma.seller.findUnique({ where: { id } });
    return row === null ? null : toSeller(row);
  }

  async updateSellerStatus(input: {
    id: string;
    action: PartnerVerificationAction;
    nextStatus: PartnerStatus;
    actorUserId: string;
  }): Promise<SellerRecord> {
    // The transition itself is validated by the use-case (pure state machine). Here we just
    // persist it, stamping verification metadata when a partner becomes VERIFIED.
    const becomingVerified = input.nextStatus === 'VERIFIED';
    const row = await this.prisma.seller.update({
      where: { id: input.id },
      data: {
        status: input.nextStatus,
        verifiedAt: becomingVerified ? new Date() : undefined,
        verifiedByUserId: becomingVerified ? input.actorUserId : undefined,
      },
    });
    return toSeller(row);
  }

  // ==========================================================================
  // Products & variants
  // ==========================================================================

  async createProduct(input: {
    sellerId: string;
    name: string;
    slug: string;
    description: string;
    recycledContent: string | null;
  }): Promise<ProductRecord> {
    try {
      const row = await this.prisma.product.create({
        data: input,
        include: PRODUCT_INCLUDE,
      });
      return toProduct(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A product with that slug already exists.');
      }
      throw error;
    }
  }

  async setProductStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
  ): Promise<ProductRecord> {
    const row = await this.prisma.product.update({
      where: { id },
      data: { status },
      include: PRODUCT_INCLUDE,
    });
    return toProduct(row);
  }

  async findProductById(id: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    return row === null ? null : toProduct(row);
  }

  async createVariant(input: {
    productId: string;
    sku: string;
    name: string;
    pricePaise: number;
    stock: number;
  }): Promise<VariantRecord> {
    try {
      const row = await this.prisma.productVariant.create({ data: input });
      return toVariant(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('A variant with that SKU already exists.');
      }
      throw error;
    }
  }

  async updateVariant(input: {
    id: string;
    pricePaise?: number;
    stock?: number;
    isActive?: boolean;
  }): Promise<VariantRecord> {
    const row = await this.prisma.productVariant.update({
      where: { id: input.id },
      data: {
        pricePaise: input.pricePaise,
        stock: input.stock,
        isActive: input.isActive,
      },
    });
    return toVariant(row);
  }

  // ==========================================================================
  // Catalogue (public)
  // ==========================================================================

  async listActiveProducts(): Promise<ProductRecord[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: 'ACTIVE', seller: { status: 'VERIFIED' } },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProduct);
  }

  async findActiveProductBySlug(slug: string): Promise<ProductRecord | null> {
    const row = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', seller: { status: 'VERIFIED' } },
      include: PRODUCT_INCLUDE,
    });
    return row === null ? null : toProduct(row);
  }

  // ==========================================================================
  // Cart
  // ==========================================================================

  async getCart(userId: string): Promise<CartRecord> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: CART_INCLUDE,
    });
    return toCart(cart);
  }

  async addToCart(input: {
    userId: string;
    variantId: string;
    quantity: number;
  }): Promise<CartRecord> {
    await this.assertBuyableVariant(input.variantId);

    const cart = await this.prisma.cart.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId },
      select: { id: true },
    });

    // Accumulate onto any existing line rather than creating a duplicate — the (cartId,
    // variantId) unique index makes upsert the natural expression of that.
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      update: { quantity: { increment: input.quantity } },
      create: { cartId: cart.id, variantId: input.variantId, quantity: input.quantity },
    });

    return this.getCart(input.userId);
  }

  async setCartItemQuantity(input: {
    userId: string;
    variantId: string;
    quantity: number;
  }): Promise<CartRecord> {
    const cart = await this.prisma.cart.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId },
      select: { id: true },
    });

    if (input.quantity === 0) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, variantId: input.variantId },
      });
      return this.getCart(input.userId);
    }

    await this.assertBuyableVariant(input.variantId);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      update: { quantity: input.quantity },
      create: { cartId: cart.id, variantId: input.variantId, quantity: input.quantity },
    });

    return this.getCart(input.userId);
  }

  async clearCart(userId: string): Promise<void> {
    const cart = await this.prisma.cart.findUnique({ where: { userId }, select: { id: true } });
    if (cart !== null) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
  }

  private async assertBuyableVariant(variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true } } },
    });

    if (variant === null || !variant.isActive || variant.product.status !== 'ACTIVE') {
      // 404, not 403: do not reveal whether an id exists but is unbuyable vs does not exist.
      throw new NotFoundError('That product is not available.');
    }
  }

  // ==========================================================================
  // Checkout
  // ==========================================================================

  async createPendingOrderFromCart(input: {
    userId: string;
    requestedWalletPaise: number;
    shippingAddressId: string | null;
  }): Promise<OrderRecord> {
    return this.prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId: input.userId },
        include: CART_INCLUDE,
      });

      const cartItems = cart?.items ?? [];
      if (cartItems.length === 0) {
        throw new ConflictError('Your cart is empty.');
      }

      // Snapshot the CURRENT price and details of each line. A variant that has gone inactive
      // or whose product is no longer ACTIVE cannot be ordered — it may have been pulled.
      const lines = cartItems.map((item) => {
        if (!item.variant.isActive || item.variant.product.status !== 'ACTIVE') {
          throw new ConflictError(
            `"${item.variant.product.name}" is no longer available; remove it to check out.`,
          );
        }
        return {
          variantId: item.variantId,
          sku: item.variant.sku,
          productName: item.variant.product.name,
          variantName: item.variant.name,
          unitPricePaise: item.variant.pricePaise,
          quantity: item.quantity,
        };
      });

      const totals = calculateOrderTotals(lines);

      // Read the wallet balance to PLAN the split. This is not the debit — that happens under
      // a lock at confirmation and can still fail if the balance moves, which is exactly why
      // the wallet leg is part of the atomic confirmation and not trusted here.
      const wallet = await tx.wallet.findUnique({
        where: { userId: input.userId },
        select: { balancePaise: true },
      });
      const balancePaise = wallet === null ? 0 : Number(wallet.balancePaise);

      const split = splitPayment({
        totalPaise: totals.totalPaise,
        walletBalancePaise: balancePaise,
        requestedWalletPaise: input.requestedWalletPaise,
      });

      const order = await tx.order.create({
        data: {
          userId: input.userId,
          status: 'PENDING_PAYMENT',
          subtotalPaise: totals.subtotalPaise,
          totalPaise: totals.totalPaise,
          walletAppliedPaise: split.walletPaise,
          gatewayAmountPaise: split.gatewayPaise,
          shippingAddressId: input.shippingAddressId,
          items: {
            create: totals.lines.map((line, index) => ({
              variantId: lines[index]!.variantId,
              sku: lines[index]!.sku,
              productName: lines[index]!.productName,
              variantName: lines[index]!.variantName,
              unitPricePaise: line.unitPricePaise,
              quantity: line.quantity,
              lineTotalPaise: line.lineTotalPaise,
            })),
          },
        },
        include: ORDER_INCLUDE,
      });

      // The cart is consumed at checkout, so a refresh does not re-submit it.
      await tx.cartItem.deleteMany({ where: { cartId: cart!.id } });

      return toOrder(order);
    });
  }

  async attachGatewayPayment(input: {
    orderId: string;
    provider: string;
    gatewayOrderId: string;
    amountPaise: number;
  }): Promise<void> {
    await this.prisma.payment.create({
      data: {
        orderId: input.orderId,
        provider: input.provider,
        gatewayOrderId: input.gatewayOrderId,
        amountPaise: input.amountPaise,
        status: 'CREATED',
      },
    });
  }

  // ==========================================================================
  // Confirmation — THE atomic move
  // ==========================================================================

  async confirmWalletOnlyOrder(input: {
    orderId: string;
    actorUserId: string;
  }): Promise<ConfirmOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await this.lockOrder(tx, input.orderId);
        if (order === null) {
          throw new NotFoundError('Order not found.');
        }
        if (order.status !== 'PENDING_PAYMENT') {
          // A retry of an order already resolved. No side effects.
          return { status: 'ALREADY_RESOLVED', order: await this.reload(tx, input.orderId) };
        }

        await this.applyConfirmation(tx, order);
        return { status: 'CONFIRMED', order: await this.reload(tx, input.orderId) };
      });
    } catch (error) {
      return this.mapConfirmFailure(error, input.orderId);
    }
  }

  async confirmOrderFromWebhook(input: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    webhook: { provider: string; eventId: string; eventType: string };
  }): Promise<ConfirmOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // IDEMPOTENCY, first statement in the transaction: recording the event and confirming
        // the order commit together. A redelivered webhook collides on the unique
        // (provider, eventId) index and the whole transaction aborts — so a replay can neither
        // double-decrement stock nor double-debit the wallet.
        await tx.webhookEvent.create({
          data: {
            provider: input.webhook.provider,
            eventId: input.webhook.eventId,
            eventType: input.webhook.eventType,
          },
        });

        const payment = await tx.payment.findUnique({
          where: { gatewayOrderId: input.gatewayOrderId },
          select: { orderId: true },
        });
        if (payment === null) {
          throw new NotFoundError('No order matches this gateway payment.');
        }

        const order = await this.lockOrder(tx, payment.orderId);
        if (order === null) {
          throw new NotFoundError('Order not found.');
        }
        if (order.status !== 'PENDING_PAYMENT') {
          // A genuinely new event for an already-resolved order: record it, do nothing else.
          return { status: 'ALREADY_RESOLVED', order: await this.reload(tx, order.id) };
        }

        await this.applyConfirmation(tx, order);

        await tx.payment.update({
          where: { orderId: order.id },
          data: {
            status: 'CAPTURED',
            gatewayPaymentId: input.gatewayPaymentId,
            capturedAt: new Date(),
          },
        });

        return { status: 'CONFIRMED', order: await this.reload(tx, order.id) };
      });
    } catch (error) {
      // A replayed webhook: the (provider, eventId) insert lost the race, aborting the whole
      // transaction. Not a failure — the first delivery already did the work. We confirm this
      // is the dedup collision (rather than some other unique violation) by checking that the
      // event row now exists, which is version-agnostic unlike matching P2002 metadata.
      if (isUniqueViolation(error)) {
        const seen = await this.prisma.webhookEvent.findUnique({
          where: {
            provider_eventId: {
              provider: input.webhook.provider,
              eventId: input.webhook.eventId,
            },
          },
        });
        if (seen !== null) {
          const order = await this.findOrderByGatewayOrderId(input.gatewayOrderId);
          if (order !== null) {
            this.logger.debug(
              `Duplicate webhook ${input.webhook.eventId} ignored for ${order.id}.`,
            );
            return { status: 'ALREADY_RESOLVED', order };
          }
        }
      }
      const order = await this.findOrderByGatewayOrderId(input.gatewayOrderId);
      return this.mapConfirmFailure(error, order?.id ?? null);
    }
  }

  /**
   * The shared body of every confirmation: validate the transition, decrement each line's
   * stock with the conditional oversell guard, debit the wallet portion, and mark the order
   * CONFIRMED. Runs entirely inside the caller's transaction — if any step throws, ALL of it
   * rolls back, so there is no state where stock moved but the wallet did not, or vice versa.
   */
  private async applyConfirmation(tx: Tx, order: LockedOrder): Promise<void> {
    applyOrderTransition(order.status, 'CONFIRM');

    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      select: { variantId: true, sku: true, quantity: true },
    });

    await this.decrementInventory(tx, items);

    if (order.walletAppliedPaise > 0) {
      // May throw InsufficientBalanceError if the balance dropped since checkout — which
      // rolls the whole confirmation back, exactly as an oversold line does.
      await this.ledger.debitForOrder(tx, {
        userId: order.userId,
        orderId: order.id,
        amountPaise: BigInt(order.walletAppliedPaise),
        actorUserId: order.userId,
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
  }

  /**
   * Decrements stock with a CONDITIONAL update per line: `UPDATE ... WHERE stock >= qty`.
   * When two orders race for the last unit, Postgres serialises the updates on the variant
   * row; the loser's update matches zero rows and we throw OutOfStockError. A read-then-write
   * in application code would lose that race — the guard has to be the WHERE clause.
   */
  private async decrementInventory(tx: Tx, items: OrderLineForConfirm[]): Promise<void> {
    for (const item of items) {
      const affected = await tx.$executeRaw`
        UPDATE "product_variants"
        SET "stock" = "stock" - ${item.quantity}, "updatedAt" = now()
        WHERE "id" = ${item.variantId}::uuid AND "stock" >= ${item.quantity}
      `;

      if (affected === 0) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stock: true },
        });
        throw new OutOfStockError(item.sku, item.quantity, variant?.stock ?? 0);
      }
    }
  }

  private async lockOrder(tx: Tx, orderId: string): Promise<LockedOrder | null> {
    const rows = await tx.$queryRaw<
      {
        id: string;
        userId: string;
        status: OrderStatus;
        walletAppliedPaise: number;
        gatewayAmountPaise: number;
      }[]
    >`
      SELECT "id", "userId", "status", "walletAppliedPaise", "gatewayAmountPaise"
      FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  private async reload(tx: Tx, orderId: string): Promise<OrderRecord> {
    const row = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    return toOrder(row);
  }

  /** Maps an error escaping a confirmation transaction onto a business outcome. */
  private async mapConfirmFailure(error: unknown, orderId: string | null): Promise<ConfirmOutcome> {
    if (
      orderId !== null &&
      (error instanceof OutOfStockError || error instanceof InsufficientBalanceError)
    ) {
      const order = await this.findOrderById(orderId);
      if (order !== null) {
        return error instanceof OutOfStockError
          ? { status: 'INSUFFICIENT_STOCK', order, detail: error.message }
          : { status: 'INSUFFICIENT_WALLET', order, detail: error.message };
      }
    }
    throw error;
  }

  // ==========================================================================
  // Order compensation & reads
  // ==========================================================================

  async failOrder(input: { orderId: string; reason: string }): Promise<void> {
    // Conditional: only a still-pending order fails. A retry that arrives after the order was
    // already failed (or confirmed) is a no-op, so this is safe to call more than once.
    await this.prisma.order.updateMany({
      where: { id: input.orderId, status: 'PENDING_PAYMENT' },
      data: { status: 'FAILED', failureReason: input.reason, cancelledAt: new Date() },
    });
  }

  async markPaymentRefunded(input: { orderId: string; refundId: string }): Promise<void> {
    // Guarded so the refund is recorded at most once: only a CAPTURED (or CREATED) payment
    // moves to REFUNDED. A second call finds nothing to update.
    await this.prisma.payment.updateMany({
      where: { orderId: input.orderId, status: { in: ['CAPTURED', 'CREATED'] } },
      data: { status: 'REFUNDED', refundId: input.refundId, refundedAt: new Date() },
    });
  }

  async findOrderById(id: string): Promise<OrderRecord | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    return row === null ? null : toOrder(row);
  }

  async findOrderByGatewayOrderId(gatewayOrderId: string): Promise<OrderRecord | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayOrderId },
      select: { orderId: true },
    });
    return payment === null ? null : this.findOrderById(payment.orderId);
  }

  async listOrdersForUser(userId: string): Promise<OrderRecord[]> {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toOrder);
  }

  async setOrderFulfilmentStatus(input: {
    orderId: string;
    nextStatus: Extract<OrderStatus, 'SHIPPED' | 'DELIVERED'>;
  }): Promise<OrderRecord> {
    const row = await this.prisma.order.update({
      where: { id: input.orderId },
      data: { status: input.nextStatus },
      include: ORDER_INCLUDE,
    });
    return toOrder(row);
  }
}

// ---------------------------------------------------------------------------
// Prisma include shapes & mappers
// ---------------------------------------------------------------------------

const PRODUCT_INCLUDE = {
  seller: { select: { name: true } },
  variants: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ProductInclude;

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: { variant: { include: { product: { select: { name: true, status: true } } } } },
  },
} satisfies Prisma.CartInclude;

const ORDER_INCLUDE = {
  items: { orderBy: { sku: 'asc' } },
  payment: true,
} satisfies Prisma.OrderInclude;

function toSeller(row: {
  id: string;
  name: string;
  status: PartnerStatus;
  gstin: string | null;
  contactName: string;
  contactPhone: string;
  city: string;
  state: string;
  verifiedAt: Date | null;
}): SellerRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    gstin: row.gstin,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    city: row.city,
    state: row.state,
    verifiedAt: row.verifiedAt,
  };
}

function toVariant(row: {
  id: string;
  sku: string;
  name: string;
  pricePaise: number;
  stock: number;
  isActive: boolean;
}): VariantRecord {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    pricePaise: row.pricePaise,
    stock: row.stock,
    isActive: row.isActive,
  };
}

function toProduct(row: {
  id: string;
  sellerId: string;
  seller: { name: string };
  name: string;
  slug: string;
  description: string;
  recycledContent: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  variants: Parameters<typeof toVariant>[0][];
}): ProductRecord {
  return {
    id: row.id,
    sellerId: row.sellerId,
    sellerName: row.seller.name,
    name: row.name,
    slug: row.slug,
    description: row.description,
    recycledContent: row.recycledContent,
    status: row.status,
    variants: row.variants.map(toVariant),
  };
}

function toCart(cart: {
  id: string;
  items: {
    variantId: string;
    quantity: number;
    variant: {
      sku: string;
      name: string;
      pricePaise: number;
      stock: number;
      isActive: boolean;
      product: { name: string; status: string };
    };
  }[];
}): CartRecord {
  const lines = cart.items.map((item) => ({
    variantId: item.variantId,
    sku: item.variant.sku,
    productName: item.variant.product.name,
    variantName: item.variant.name,
    unitPricePaise: item.variant.pricePaise,
    quantity: item.quantity,
    lineTotalPaise: item.variant.pricePaise * item.quantity,
    availableStock: item.variant.stock,
    variantActive: item.variant.isActive && item.variant.product.status === 'ACTIVE',
  }));

  return {
    id: cart.id,
    lines,
    subtotalPaise: lines.reduce((sum, line) => sum + line.lineTotalPaise, 0),
  };
}

function toOrder(row: {
  id: string;
  userId: string;
  status: OrderStatus;
  subtotalPaise: number;
  totalPaise: number;
  walletAppliedPaise: number;
  gatewayAmountPaise: number;
  shippingAddressId: string | null;
  failureReason: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  items: {
    variantId: string;
    sku: string;
    productName: string;
    variantName: string;
    unitPricePaise: number;
    quantity: number;
    lineTotalPaise: number;
  }[];
  payment: {
    provider: string;
    gatewayOrderId: string;
    gatewayPaymentId: string | null;
    amountPaise: number;
    status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
    refundId: string | null;
  } | null;
}): OrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    subtotalPaise: row.subtotalPaise,
    totalPaise: row.totalPaise,
    walletAppliedPaise: row.walletAppliedPaise,
    gatewayAmountPaise: row.gatewayAmountPaise,
    shippingAddressId: row.shippingAddressId,
    failureReason: row.failureReason,
    items: row.items.map((item) => ({ ...item })),
    payment:
      row.payment === null
        ? null
        : {
            provider: row.payment.provider,
            gatewayOrderId: row.payment.gatewayOrderId,
            gatewayPaymentId: row.payment.gatewayPaymentId,
            amountPaise: row.payment.amountPaise,
            status: row.payment.status,
            refundId: row.payment.refundId,
          },
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
