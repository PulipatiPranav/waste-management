/**
 * The boundary between our order flow and whichever payment provider actually moves the
 * card/UPI money. Razorpay is the concrete adapter (it is the default for Indian consumer
 * apps), but the business logic — checkout, confirmation, refund — only ever sees this
 * interface. No use-case and no repository imports the Razorpay SDK or its field names; a
 * switch to Cashfree or Stripe is a new adapter and a config change, not a rewrite.
 */

export interface CreateGatewayOrderInput {
  /** INTEGER PAISE — the gateway portion of the order only. */
  amountPaise: number;
  currency: string;
  /** Our order id, so the gateway's dashboard and ours reconcile. */
  receipt: string;
  notes?: Record<string, string>;
}

export interface GatewayOrder {
  gatewayOrderId: string;
  amountPaise: number;
  currency: string;
}

/**
 * The normalised shape of a gateway webhook after the adapter has parsed the provider's
 * envelope.
 *
 * Note there is no `eventId` here: the provider's unique-per-delivery id — the key the
 * idempotency ledger dedupes on — arrives in a HEADER (Razorpay's `x-razorpay-event-id`),
 * not the body, so the controller reads it there and the adapter never sees it. This
 * interface is only what can be recovered from the signed body.
 */
export interface GatewayWebhookEvent {
  /** e.g. 'payment.captured', 'payment.failed'. */
  eventType: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amountPaise: number | null;
}

export interface RefundResult {
  refundId: string;
}

export interface PaymentGateway {
  /** For logs and the Payment.provider column. */
  readonly provider: string;

  /** The publishable key the client checkout widget needs. Never the secret. */
  readonly publicKeyId: string;

  /** Opens a gateway order for the card/UPI leg. Returns the id the client widget charges. */
  createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder>;

  /**
   * True iff this raw body was signed by the gateway with our webhook secret. MUST be given
   * the exact raw request bytes, not a re-serialised object. See webhook-signature.ts.
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;

  /** Parses a verified raw body into the normalised event. Assumes the signature is checked. */
  parseWebhookEvent(rawBody: string): GatewayWebhookEvent;

  /**
   * Returns captured money. The compensating action when an order that was paid at the
   * gateway cannot be confirmed (oversold, wallet balance moved). Must be idempotent at the
   * caller: it is only ever invoked once per payment, guarded by the payment's status.
   */
  refund(input: { gatewayPaymentId: string; amountPaise: number }): Promise<RefundResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
