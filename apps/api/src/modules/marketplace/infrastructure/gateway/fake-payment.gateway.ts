import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import {
  type CreateGatewayOrderInput,
  type GatewayOrder,
  type GatewayWebhookEvent,
  type PaymentGateway,
  type RefundResult,
} from '../../domain/ports/payment-gateway';
import { verifyWebhookSignature } from '../../domain/webhook-signature';

/**
 * An in-process payment gateway for local development and tests.
 *
 * It fabricates deterministic order/payment/refund ids and NEVER touches a network — but it
 * verifies webhook signatures with the exact same real HMAC scheme as the Razorpay adapter,
 * against the same PAYMENT_WEBHOOK_SECRET. That is the deliberate design: the security-
 * critical path (is this webhook genuine?) and the idempotency path (same event twice) are
 * exercised for real in tests, while the parts that would require a live merchant account
 * are stubbed. It parses the same webhook body shape Razorpay sends, so a test can construct
 * a realistic payload and sign it.
 *
 * The env schema REFUSES this provider in production — an order confirmed here moved no money.
 */
@Injectable()
export class FakePaymentGateway implements PaymentGateway {
  readonly provider = 'fake';
  readonly publicKeyId: string;

  private readonly logger = new Logger(FakePaymentGateway.name);
  private readonly webhookSecret: string;
  private seq = 0;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.webhookSecret = this.config.get('PAYMENT_WEBHOOK_SECRET', { infer: true });
    this.publicKeyId = 'fake_key_local';
  }

  createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
    if (input.amountPaise <= 0) {
      // A gateway order for zero is a bug in the caller: a fully-wallet-paid order takes the
      // synchronous confirmation path and never reaches a gateway at all.
      throw new InvariantViolationError('A gateway order must be for a positive amount.');
    }

    // Deterministic id derived from the receipt (our order id), so a test can predict it and
    // there is no reliance on Date.now()/random, which are banned in parts of this codebase.
    this.seq += 1;
    const gatewayOrderId = `order_fake_${input.receipt.replace(/-/g, '').slice(0, 20)}`;
    this.logger.debug(`Fake gateway order ${gatewayOrderId} for ${input.amountPaise} paise`);

    return Promise.resolve({
      gatewayOrderId,
      amountPaise: input.amountPaise,
      currency: input.currency,
    });
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return verifyWebhookSignature({ rawBody, signature, secret: this.webhookSecret });
  }

  parseWebhookEvent(rawBody: string): GatewayWebhookEvent {
    return parseRazorpayStyleWebhook(rawBody);
  }

  refund(input: { gatewayPaymentId: string; amountPaise: number }): Promise<RefundResult> {
    this.logger.warn(
      `Fake refund of ${input.amountPaise} paise for payment ${input.gatewayPaymentId}`,
    );
    return Promise.resolve({ refundId: `rfnd_fake_${input.gatewayPaymentId}` });
  }
}

/**
 * Parses the Razorpay webhook body shape (also used by the fake, on purpose):
 *   { event, payload: { payment: { entity: { id, order_id, amount, ... } } } }
 * Amounts arrive in paise (Razorpay's smallest-unit convention == ours).
 */
export function parseRazorpayStyleWebhook(rawBody: string): GatewayWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new InvariantViolationError('Webhook body is not valid JSON.');
  }

  const root = parsed as {
    event?: unknown;
    payload?: { payment?: { entity?: { id?: unknown; order_id?: unknown; amount?: unknown } } };
  };

  const entity = root.payload?.payment?.entity;

  return {
    eventType: typeof root.event === 'string' ? root.event : 'unknown',
    gatewayOrderId: typeof entity?.order_id === 'string' ? entity.order_id : null,
    gatewayPaymentId: typeof entity?.id === 'string' ? entity.id : null,
    amountPaise: typeof entity?.amount === 'number' ? entity.amount : null,
  };
}
