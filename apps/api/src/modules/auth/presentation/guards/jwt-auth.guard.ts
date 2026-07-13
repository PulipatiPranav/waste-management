import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import { AccountSuspendedError, UnauthenticatedError } from '../../domain/errors/auth.errors';
import { TOKEN_ISSUER, type TokenIssuer } from '../../domain/ports/token-issuer.port';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally (see auth.module.ts), so every endpoint requires a valid access
 * token unless it is explicitly marked `@Public()`.
 *
 * Default-deny is the point. A per-controller guard fails open: the endpoint someone
 * forgets to annotate ships unauthenticated and nothing complains.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_ISSUER) private readonly tokenIssuer: TokenIssuer,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (token === null) {
      throw new UnauthenticatedError('Authentication is required.');
    }

    const claims = await this.tokenIssuer.verifyAccessToken(token);

    if (claims === null) {
      throw new UnauthenticatedError('The access token is invalid or has expired.');
    }

    // A database read on every authenticated request, deliberately.
    //
    // A JWT is a bearer credential frozen at issue time: without this lookup, a
    // suspended user keeps full access until their token expires, and a role
    // *downgrade* does not take effect either — a demoted admin would keep admin
    // rights for the rest of the token's life. For a system that moves money, that
    // window is not acceptable. The cost is one indexed primary-key lookup, and Phase
    // 14 can cache it in Redis if it ever shows up in the traces.
    const user = await this.users.findById(claims.sub);

    if (user === null) {
      throw new UnauthenticatedError('The access token is invalid or has expired.');
    }

    if (!user.isActive) {
      throw new AccountSuspendedError();
    }

    // The role is taken from the DATABASE, not from the token, for the same reason.
    request.user = { id: user.id, role: user.role };

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.header('authorization');

    if (header === undefined) return null;

    const [scheme, token] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) {
      return null;
    }

    return token;
  }
}
