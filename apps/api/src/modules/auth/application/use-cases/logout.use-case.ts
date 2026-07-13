import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../../domain/ports/clock.port';
import { TOKEN_HASHER, type TokenHasher } from '../../domain/ports/hasher.port';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../../domain/ports/refresh-token.repository';

export interface LogoutCommand {
  refreshToken: string;
}

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(TOKEN_HASHER) private readonly tokenHasher: TokenHasher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Revokes the whole family, not just the presented token, so logging out on one
   * device cannot leave a rotated descendant alive.
   *
   * Silent on an unknown token: logout must be idempotent. A client retrying after a
   * network blip should not see an error, and an attacker probing tokens here should
   * learn nothing about which ones exist.
   *
   * Note the already-issued ACCESS token stays valid until it expires (15 minutes) —
   * that is the accepted trade of stateless JWTs. Anything needing instant revocation
   * (a suspension) is enforced against `isActive` in the guard on every request.
   */
  async execute(command: LogoutCommand): Promise<void> {
    const stored = await this.refreshTokens.findByHash(this.tokenHasher.hash(command.refreshToken));

    if (stored === null) return;

    await this.refreshTokens.revokeFamily(stored.family, this.clock.now());
  }
}
