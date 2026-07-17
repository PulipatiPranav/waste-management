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
import { parseRazorpayStyleWebhook } from './fake-payment.gateway';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/**
 * The real Razorpay adapter. The default gateway for Indian consumer apps, which is why it
 * is the concrete choice — but nothing in the order flow knows that: it talks only to the
 * PaymentGateway port, and the Razorpay-specific bits (REST shapes, Basic-auth, the smallest-
 * unit amount convention) are confined to this file.
 *
 * Order creation and refunds are plain REST calls over `fetch` — the Razorpay SDK is not
 * pulled in, so no vendor code reaches the business layer and there is no native dependency
 * to bloat the image. Webhook verification and parsing are shared with the fake gateway, so
 * the exact same signature check and body parser run in dev, in tests, and in production.
 */
@Injectable()
export class RazorpayPaymentGateway implements PaymentGateway {
  readonly provider = 'razorpay';
  readonly publicKeyId: string;

  private readonly logger = new Logger(RazorpayPaymentGateway.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const keyId = this.config.get('RAZORPAY_KEY_ID', { infer: true });
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET', { infer: true });

    // The env schema already refuses to boot the `razorpay` provider without these, so this
    // is belt-and-braces — but a missing credential must fail loudly here, not as an
    // Authorization header of "Basic undefined" at the gateway.
    if (keyId === undefined || keySecret === undefined) {
      throw new Error('RazorpayPaymentGateway requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    }

    this.keyId = keyId;
    this.keySecret = keySecret;
    this.publicKeyId = keyId;
    this.webhookSecret = this.config.get('PAYMENT_WEBHOOK_SECRET', { infer: true });
  }

  async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
    if (input.amountPaise <= 0) {
      throw new InvariantViolationError('A gateway order must be for a positive amount.');
    }

    const body = await this.request<{ id: string; amount: number; currency: string }>(
      'POST',
      '/orders',
      {
        amount: input.amountPaise, // Razorpay amounts are in the smallest unit — paise. No conversion.
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      },
    );

    return { gatewayOrderId: body.id, amountPaise: body.amount, currency: body.currency };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return verifyWebhookSignature({ rawBody, signature, secret: this.webhookSecret });
  }

  parseWebhookEvent(rawBody: string): GatewayWebhookEvent {
    return parseRazorpayStyleWebhook(rawBody);
  }

  async refund(input: { gatewayPaymentId: string; amountPaise: number }): Promise<RefundResult> {
    const body = await this.request<{ id: string }>(
      'POST',
      `/payments/${input.gatewayPaymentId}/refund`,
      { amount: input.amountPaise },
    );
    return { refundId: body.id };
  }

  private async request<T>(method: 'POST' | 'GET', path: string, payload: unknown): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');

    const response = await fetch(`${RAZORPAY_API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`Razorpay ${method} ${path} failed: ${response.status} ${text}`);
      throw new Error(`Razorpay request failed with ${response.status}.`);
    }

    return (await response.json()) as T;
  }
}
