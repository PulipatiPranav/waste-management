export interface StoredRefreshToken {
  id: string;
  userId: string;
  family: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  family: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<StoredRefreshToken>;

  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;

  /**
   * Revokes `id` and creates the replacement in ONE transaction.
   *
   * Atomicity is the whole point. If the revoke commits and the insert fails, the
   * user is silently logged out mid-session; if the insert commits and the revoke
   * fails, the old token stays valid forever and rotation is a lie.
   */
  rotate(oldTokenId: string, next: CreateRefreshTokenInput, at: Date): Promise<StoredRefreshToken>;

  /**
   * Revokes every live token in a family.
   *
   * Called on reuse detection: a token that was already revoked has been presented
   * again, so either the client or a thief is replaying it and we cannot tell which.
   * Killing the family forces both back through login — the only safe move.
   */
  revokeFamily(family: string, at: Date): Promise<number>;

  /** Logout. Revokes the single presented token's family. */
  revokeById(id: string, at: Date): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
