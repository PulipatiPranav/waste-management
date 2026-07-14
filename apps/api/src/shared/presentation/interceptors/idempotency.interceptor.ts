import {
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { from, type Observable, of, tap } from 'rxjs';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

export const IDEMPOTENT_KEY = 'idempotency:required';

/**
 * Marks an endpoint as requiring an `Idempotency-Key` header.
 *
 * Applied to every endpoint that MOVES MONEY. A delivery partner completing a pickup is
 * standing in a doorway on a 2G connection with a spinner on screen; they will tap again.
 * Without this, that second tap credits the wallet twice.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

const HEADER = 'idempotency-key';

/**
 * Replay protection for money-moving requests.
 *
 * Three cases, and the third is the one people forget:
 *
 *   1. New key      -> run the handler, store the response, return it.
 *   2. Same key, same body -> return the STORED response. Do not run the handler again.
 *   3. Same key, DIFFERENT body -> 409. This is a client bug or an attack: the caller is
 *      trying to reuse a key that already answered a different question, and silently
 *      handing back the old response would be the wrong answer to the new request.
 *
 * The in-flight case (a concurrent duplicate arriving before the first has finished) is
 * handled by the unique index on (userId, key, endpoint): the second insert fails, and we
 * return 409 rather than letting it through. The caller retries and gets the cached
 * response.
 *
 * This is BELT. The braces are in the database: `wallet_transactions.pickupId` is unique,
 * so even a bypassed key cannot double-credit a pickup.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required !== true) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = request.header(HEADER);

    if (key === undefined || key.trim().length === 0) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: `This endpoint moves money and requires an ${HEADER} header.`,
      });
    }

    const userId = request.user?.id;

    if (userId === undefined) {
      // Unreachable behind the global JwtAuthGuard; a scoped key with no user to scope it
      // to would let one caller collide with (or probe) another's keys.
      throw new ConflictException('Idempotency requires an authenticated user.');
    }

    // The ROUTE pattern (`/pickups/:id/complete`), not the concrete path, so a key minted
    // for one endpoint cannot be replayed against another.
    const route = request.route as { path?: string } | undefined;
    const endpoint = `${request.method} ${route?.path ?? request.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(request.body ?? {}))
      .digest('hex');

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key_endpoint: { userId, key, endpoint } },
    });

    if (existing !== null) {
      // Case 3: same key, different body.
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message:
            'This Idempotency-Key was already used for a request with a different body. ' +
            'Generate a new key for a new request.',
        });
      }

      // Case: the first request is still in flight. Returning its (absent) response would
      // be a lie; tell the caller to retry.
      if (existing.responseStatus === null) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
          message: 'A request with this key is still being processed. Retry shortly.',
        });
      }

      // Case 2: the replay. Hand back exactly what we said the first time — WITHOUT
      // running the handler, so no wallet is credited a second time.
      this.logger.log(`Idempotent replay of ${endpoint} for key ${key.slice(0, 8)}…`);
      response.status(existing.responseStatus);
      response.setHeader('Idempotent-Replay', 'true');

      return of(existing.responseBody);
    }

    // Claim the key BEFORE running the handler. A concurrent duplicate now collides on the
    // unique index instead of racing through into the money path.
    try {
      await this.prisma.idempotencyKey.create({
        data: { userId, key, endpoint, requestHash },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
          message: 'A request with this key is already being processed. Retry shortly.',
        });
      }
      throw error;
    }

    return from(next.handle()).pipe(
      tap({
        next: (body: unknown) => {
          // Fire-and-forget: the money has already moved and been committed. Failing the
          // response because we could not cache it would be strictly worse — the client
          // would retry, and the retry would be correctly rejected by the database's
          // unique pickupId index, but the customer would see an error for a pickup that
          // actually succeeded.
          void this.prisma.idempotencyKey
            .update({
              where: { userId_key_endpoint: { userId, key, endpoint } },
              data: {
                responseStatus: response.statusCode,
                responseBody: body ?? {},
              },
            })
            .catch((error: unknown) => {
              this.logger.error(
                `Failed to cache idempotent response for ${endpoint}`,
                error instanceof Error ? error.stack : String(error),
              );
            });
        },
        error: () => {
          // The handler failed, so nothing was committed. Release the key so the client can
          // legitimately retry the SAME request — otherwise a transient DB blip would lock
          // that key out forever and the partner could never complete the pickup.
          void this.prisma.idempotencyKey
            .delete({ where: { userId_key_endpoint: { userId, key, endpoint } } })
            .catch(() => {
              /* already gone; nothing to do */
            });
        },
      }),
    );
  }
}
