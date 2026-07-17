import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { type Request } from 'express';

import { ConflictError } from '@/shared/domain/errors/domain.error';
import { Public } from '@/modules/auth/presentation/decorators/public.decorator';
import { MarketplaceUseCases } from '../application/marketplace.use-cases';

/**
 * The gateway → us webhook. Public (a gateway has no bearer token), but NOT unauthenticated:
 * it is authenticated by the HMAC signature over the raw body, checked before anything is
 * parsed or acted on. Excluded from Swagger — it is not part of the customer-facing API.
 *
 * The endpoint returns 200 for every event it successfully accepts, INCLUDING a duplicate or
 * an ignored event type: a gateway treats a non-2xx as a delivery failure and retries, so
 * signalling "already handled" as an error would cause an endless retry storm. Only a genuine
 * problem — a bad signature, a malformed body — is a non-2xx.
 */
@Controller({ path: 'marketplace/webhooks', version: '1' })
export class PaymentWebhookController {
  constructor(private readonly marketplace: MarketplaceUseCases) {}

  @Public()
  @Post('payment')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async payment(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ): Promise<{ outcome: string; orderId: string | null }> {
    // The RAW bytes, not a re-serialised object — the HMAC is over exactly what was sent.
    const rawBody = req.rawBody?.toString('utf8');
    if (rawBody === undefined || rawBody.length === 0) {
      throw new ConflictError('Empty webhook body.');
    }

    return this.marketplace.handleWebhook({
      rawBody,
      signature: signature ?? '',
      // Razorpay's per-delivery id, the idempotency key. Fall back to the signature so a
      // provider that omits the header still dedupes on something stable and unique.
      eventId: eventId ?? signature ?? '',
    });
  }
}
