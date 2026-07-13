import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

import { type Role } from '../../domain/value-objects/role';

/** What JwtAuthGuard attaches to the request once a token has been verified. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Injects the authenticated user into a handler.
 *
 * Handlers must take the user id from HERE and never from a route param or body. That
 * is the whole defence against IDOR: `GET /users/:id` where `id` comes from the URL is
 * how user A reads user B's wallet. Phase 14's OWASP pass will hunt for exactly that.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (request.user === undefined) {
      // Unreachable behind JwtAuthGuard. If it ever fires, an endpoint was marked
      // @Public but still asks for a user — better to blow up loudly than to hand the
      // handler `undefined` and let it query for user `undefined`.
      throw new Error(
        'CurrentUser used on an endpoint that is not authenticated. Remove @Public() or stop injecting the user.',
      );
    }

    return request.user;
  },
);
