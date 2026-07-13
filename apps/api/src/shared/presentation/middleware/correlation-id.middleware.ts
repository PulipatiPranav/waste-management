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
 * ticket can be traced to the exact request chain. Later phases thread this through
 * the logger and into BullMQ job payloads.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_ID_HEADER);
    const correlationId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
