import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';

import { type Env } from '@/config/env.schema';
import { type AccessTokenClaims, type TokenIssuer } from '../../domain/ports/token-issuer.port';
import { isRole } from '../../domain/value-objects/role';

@Injectable()
export class JwtTokenIssuer implements TokenIssuer {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  issueAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(
      { role: claims.role },
      {
        subject: claims.sub,
        expiresIn: this.config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);

      // The payload is attacker-influenced data until proven otherwise. A valid
      // signature says the token came from us, not that its shape is what we expect —
      // trusting `payload.role` blindly is how a token minted before a schema change
      // ends up carrying an unknown role straight into the RolesGuard.
      const { sub, role } = payload;

      if (typeof sub !== 'string' || !isRole(role)) return null;

      return { sub, role };
    } catch {
      // Expired, wrong signature, malformed — all the same to the caller: not authenticated.
      return null;
    }
  }

  /** 256 bits from the CSPRNG, base64url so it is safe in a header or JSON body. */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
