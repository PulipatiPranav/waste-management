import { type Role } from '../value-objects/role';

/** Claims carried inside the access token. Keep it small — it is sent on every request. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  role: Role;
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessTokenClaims): Promise<string>;

  /** Resolves to null when the token is absent, malformed, badly signed or expired. */
  verifyAccessToken(token: string): Promise<AccessTokenClaims | null>;

  /** 256 bits of CSPRNG output. Opaque to the client; only its hash is stored. */
  generateRefreshToken(): string;
}

export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');
