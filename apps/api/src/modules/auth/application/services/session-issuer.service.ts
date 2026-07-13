import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { type User } from '@/modules/users/domain/entities/user';
import { AUTH_CONFIG, type AuthConfig } from '../auth.config';
import { CLOCK, type Clock } from '../../domain/ports/clock.port';
import { TOKEN_HASHER, type TokenHasher } from '../../domain/ports/hasher.port';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';
import { TOKEN_ISSUER, type TokenIssuer } from '../../domain/ports/token-issuer.port';

export interface SessionContext {
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: 'Bearer';
}

/**
 * Mints an access/refresh pair. Shared by OTP verification, staff login and refresh,
 * so all three produce identical session semantics — one place to change TTLs, one
 * place where a refresh token is written, one place that can get it wrong.
 */
@Injectable()
export class SessionIssuerService {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(TOKEN_ISSUER) private readonly tokenIssuer: TokenIssuer,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  /** Starts a NEW token family — i.e. a fresh login, not a rotation. */
  async issueForUser(user: User, context: SessionContext): Promise<IssuedSession> {
    const refreshToken = this.tokenIssuer.generateRefreshToken();

    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: this.tokenHasher.hash(refreshToken),
      family: randomUUID(),
      expiresAt: this.refreshExpiry(),
      userAgent: context.userAgent,
      ip: context.ip,
    });

    return this.buildSession(user, refreshToken);
  }

  /**
   * Rotates within an EXISTING family: the presented token is revoked and its
   * replacement issued in one transaction. Keeping the family id is what makes reuse
   * of the old token detectable later.
   */
  async rotate(
    user: User,
    oldTokenId: string,
    family: string,
    context: SessionContext,
  ): Promise<IssuedSession> {
    const refreshToken = this.tokenIssuer.generateRefreshToken();

    await this.refreshTokens.rotate(
      oldTokenId,
      {
        userId: user.id,
        tokenHash: this.tokenHasher.hash(refreshToken),
        family,
        expiresAt: this.refreshExpiry(),
        userAgent: context.userAgent,
        ip: context.ip,
      },
      this.clock.now(),
    );

    return this.buildSession(user, refreshToken);
  }

  private async buildSession(user: User, refreshToken: string): Promise<IssuedSession> {
    const accessToken = await this.tokenIssuer.issueAccessToken({
      sub: user.id,
      role: user.role,
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: this.config.accessTokenTtlSeconds,
      tokenType: 'Bearer',
    };
  }

  private refreshExpiry(): Date {
    return new Date(this.clock.now().getTime() + this.config.refreshTokenTtlSeconds * 1000);
  }
}
