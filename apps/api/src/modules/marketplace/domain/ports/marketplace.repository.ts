import {
  type PartnerStatus,
  type PartnerVerificationAction,
} from '@/shared/domain/partner-verification';
import { type OrderStatus } from '../order-state-machine';

// --- Catalogue records ------------------------------------------------------

export interface SellerRecord {
  id: string;
  name: string;
  status: PartnerStatus;
  gstin: string | null;
  contactName: string;
  contactPhone: string;
  city: string;
  state: string;
  verifiedAt: Date | null;
}

export interface VariantRecord {
  id: string;
  sku: string;
  name: string;
  pricePaise: number;
  stock: number;
  isActive: boolean;
}

export interface ProductRecord {
  id: string;
  sellerId: string;
  sellerName: string;
  name: string;
  slug: string;
  description: string;
  recycledContent: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  variants: VariantRecord[];
}

// --- Cart records -----------------------------------------------------------

export interface CartLineRecord {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
  /** Snapshot of what is buyable right now, so the UI can flag a line that has gone short. */
  availableStock: number;
  variantActive: boolean;
}

export interface CartRecord {
  id: string;
  lines: CartLineRecord[];
  subtotalPaise: number;
}

// --- Order records ----------------------------------------------------------

export interface OrderItemRecord {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface PaymentRecord {
  provider: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  amountPaise: number;
  status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  refundId: string | null;
}

export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  subtotalPaise: number;
  totalPaise: number;
  walletAppliedPaise: number;
  gatewayAmountPaise: number;
  shippingAddressId: string | null;
  failureReason: string | null;
  items: OrderItemRecord[];
  payment: PaymentRecord | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

/**
 * The result of an attempt to confirm an order — the atomic move that decrements inventory,
 * debits the wallet, and captures the gateway payment. It NEVER throws for a business
 * failure: an oversold line or a wallet that no longer covers its portion is a normal,
 * expected outcome the caller must compensate for (fail the order, refund the gateway), so
 * it is returned as data, not as an exception.
 */
export type ConfirmOutcome =
  | { status: 'CONFIRMED'; order: OrderRecord }
  /** A replayed webhook / retried confirmation for an order already resolved. No side effects. */
  | { status: 'ALREADY_RESOLVED'; order: OrderRecord }
  | { status: 'INSUFFICIENT_STOCK'; order: OrderRecord; detail: string }
  | { status: 'INSUFFICIENT_WALLET'; order: OrderRecord; detail: string };

export interface MarketplaceRepository {
  // --- Sellers (admin) ------------------------------------------------------

  createSeller(input: {
    name: string;
    gstin: string | null;
    contactName: string;
    contactPhone: string;
    city: string;
    state: string;
  }): Promise<SellerRecord>;

  listSellers(status: PartnerStatus | null): Promise<SellerRecord[]>;
  findSellerById(id: string): Promise<SellerRecord | null>;

  /** Applies a verification transition and stamps verifiedAt/verifiedByUserId on VERIFY. */
  updateSellerStatus(input: {
    id: string;
    action: PartnerVerificationAction;
    nextStatus: PartnerStatus;
    actorUserId: string;
  }): Promise<SellerRecord>;

  // --- Products & variants (admin) ------------------------------------------

  createProduct(input: {
    sellerId: string;
    name: string;
    slug: string;
    description: string;
    recycledContent: string | null;
  }): Promise<ProductRecord>;

  setProductStatus(id: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'): Promise<ProductRecord>;
  findProductById(id: string): Promise<ProductRecord | null>;

  createVariant(input: {
    productId: string;
    sku: string;
    name: string;
    pricePaise: number;
    stock: number;
  }): Promise<VariantRecord>;

  /** Restock / reprice / (de)activate. Absolute values, not deltas — an admin sets the truth. */
  updateVariant(input: {
    id: string;
    pricePaise?: number;
    stock?: number;
    isActive?: boolean;
  }): Promise<VariantRecord>;

  // --- Catalogue (public browse) --------------------------------------------

  listActiveProducts(): Promise<ProductRecord[]>;
  findActiveProductBySlug(slug: string): Promise<ProductRecord | null>;

  // --- Cart -----------------------------------------------------------------

  getCart(userId: string): Promise<CartRecord>;

  /** Adds `quantity` of a variant, accumulating onto any existing line. Validates the variant. */
  addToCart(input: { userId: string; variantId: string; quantity: number }): Promise<CartRecord>;

  /** Sets a line to an absolute quantity, or removes it when quantity is 0. */
  setCartItemQuantity(input: {
    userId: string;
    variantId: string;
    quantity: number;
  }): Promise<CartRecord>;

  clearCart(userId: string): Promise<void>;

  // --- Checkout & orders ----------------------------------------------------

  /**
   * Turns the cart into a PENDING_PAYMENT order in ONE transaction: re-reads the current
   * variant prices and stock, snapshots them onto immutable order lines, computes the
   * wallet/gateway split against the live wallet balance, and empties the cart. Does NOT
   * move stock or money — that is confirmation. Throws if the cart is empty, a variant has
   * gone inactive, or a line already exceeds available stock (a courtesy pre-check; the real
   * guard is at confirmation).
   */
  createPendingOrderFromCart(input: {
    userId: string;
    requestedWalletPaise: number;
    shippingAddressId: string | null;
  }): Promise<OrderRecord>;

  /** Records the gateway order for an order's card leg, moving its Payment to CREATED. */
  attachGatewayPayment(input: {
    orderId: string;
    provider: string;
    gatewayOrderId: string;
    amountPaise: number;
  }): Promise<void>;

  /**
   * Confirms a fully-wallet-paid order (no gateway leg) atomically: conditional
   * PENDING_PAYMENT→CONFIRMED, decrement every line's stock, debit the wallet. All-or-nothing.
   */
  confirmWalletOnlyOrder(input: { orderId: string; actorUserId: string }): Promise<ConfirmOutcome>;

  /**
   * Confirms an order whose gateway leg was just captured, atomically and idempotently:
   * records the webhook event (the dedup guard), conditional status change, decrement stock,
   * debit the wallet portion, mark the Payment CAPTURED. A replayed webhook is a no-op.
   */
  confirmOrderFromWebhook(input: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    webhook: { provider: string; eventId: string; eventType: string };
  }): Promise<ConfirmOutcome>;

  /** Marks a PENDING_PAYMENT order FAILED (idempotent). Used when confirmation cannot complete. */
  failOrder(input: { orderId: string; reason: string }): Promise<void>;

  /** Records that the gateway refund went out. Guarded so it can be called at most once. */
  markPaymentRefunded(input: { orderId: string; refundId: string }): Promise<void>;

  findOrderById(id: string): Promise<OrderRecord | null>;
  findOrderByGatewayOrderId(gatewayOrderId: string): Promise<OrderRecord | null>;
  listOrdersForUser(userId: string): Promise<OrderRecord[]>;

  /** Admin fulfilment: SHIP / DELIVER after CONFIRMED. Applies the state-machine transition. */
  setOrderFulfilmentStatus(input: {
    orderId: string;
    nextStatus: Extract<OrderStatus, 'SHIPPED' | 'DELIVERED'>;
  }): Promise<OrderRecord>;
}

export const MARKETPLACE_REPOSITORY = Symbol('MARKETPLACE_REPOSITORY');
