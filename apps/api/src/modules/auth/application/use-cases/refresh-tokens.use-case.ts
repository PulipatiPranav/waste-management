import { Inject, Injectable, Logger } from '@nestjs/common';

import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import { AccountSuspendedError, InvalidRefreshTokenError } from '../../domain/errors/auth.errors';
import { CLOCK, type Clock } from '../../domain/ports/clock.port';
import { TOKEN_HASHER, type TokenHasher } from '../../domain/ports/hasher.port';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import {
  type IssuedSession,
  type SessionContext,
  SessionIssuerService,
} from '../services/session-issuer.service';

export interface RefreshTokensCommand {
  refreshToken: string;
  context: SessionContext;
}

@Injectable()
export class RefreshTokensUseCase {
  private readonly logger = new Logger(RefreshTokensUseCase.name);

  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessionIssuer: SessionIssuerService,
  ) {}

  async execute(command: RefreshTokensCommand): Promise<IssuedSession> {
    const now = this.clock.now();
    const tokenHash = this.tokenHasher.hash(command.refreshToken);

    const stored = await this.refreshTokens.findByHash(tokenHash);

    if (stored === null) {
      throw new InvalidRefreshTokenError();
    }

    // ---- Reuse detection -----------------------------------------------------
    //
    // Rotation revokes a token the moment it is exchanged, so a *revoked* token being
    // presented again means it was captured and replayed — by an attacker who stole
    // it, or by the legitimate client replaying one the attacker already used. We
    // cannot tell which, and guessing wrong either way is bad.
    //
    // So we revoke the entire family. Both parties are forced back through login,
    // which the attacker cannot pass (they do not have the phone). The cost is one
    // unexpected logout; the alternative is leaving a thief with a live session.
    if (stored.revokedAt !== null) {
      const revokedCount = await this.refreshTokens.revokeFamily(stored.family, now);

      this.logger.error(
        `Refresh token reuse detected for user ${stored.userId}. ` +
          `Revoked ${revokedCount} token(s) in family ${stored.family}. ` +
          `This is either token theft or a buggy client replaying a spent token.`,
      );

      throw new InvalidRefreshTokenError('Session revoked. Sign in again.');
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.users.findById(stored.userId);

    if (user === null) {
      throw new InvalidRefreshTokenError();
    }

    // Suspension takes effect at the next refresh at the latest, rather than whenever
    // the current access token happens to expire.
    if (!user.isActive) {
      await this.refreshTokens.revokeFamily(stored.family, now);
      throw new AccountSuspendedError();
    }

    return this.sessionIssuer.rotate(user, stored.id, stored.family, command.context);
  }
}
