import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Stamps every request with a correlation ID, reusing the caller's if it sent one.
 *
 * The mobile app sends its own ID so that "my cashback didn't arrive" in a support
 * ticket can be traced to the exact request chain. The pino logger's `genReqId` uses
 * this same value as `reqId`, so every structured log line for the request carries it.
 *
 * Idempotent by design: it reuses an id already on the request (pino's `genReqId` may
 * have run first) rather than minting a second one, so the correlation id is the same
 * regardless of which of the two runs first.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_ID_HEADER);
    const correlationId =
      req.correlationId ?? (incoming && incoming.trim().length > 0 ? incoming : randomUUID());

    req.correlationId = correlationId;
    if (!res.headersSent) res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
