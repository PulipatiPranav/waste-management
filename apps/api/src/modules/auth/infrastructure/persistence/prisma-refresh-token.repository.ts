import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import {
  type CreateRefreshTokenInput,
  type RefreshTokenRepository,
  type StoredRefreshToken,
} from '../../domain/ports/refresh-token.repository';

@Injectable()
export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateRefreshTokenInput): Promise<StoredRefreshToken> {
    const row = await this.prisma.refreshToken.create({ data: input });
    return this.toDomain(row);
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row === null ? null : this.toDomain(row);
  }

  /**
   * Revoke the old token and issue its replacement, atomically.
   *
   * Both writes must land together. Revoke-without-insert silently signs the user out
   * mid-session; insert-without-revoke leaves the old token valid forever, which means
   * rotation is not happening and reuse detection can never fire. `$transaction` is
   * what makes "rotation" a fact rather than an intention.
   */
  async rotate(
    oldTokenId: string,
    next: CreateRefreshTokenInput,
    at: Date,
  ): Promise<StoredRefreshToken> {
    const created = await this.prisma.$transaction(async (tx) => {
      const replacement = await tx.refreshToken.create({ data: next });

      await tx.refreshToken.update({
        where: { id: oldTokenId },
        data: { revokedAt: at, replacedByTokenId: replacement.id },
      });

      return replacement;
    });

    return this.toDomain(created);
  }

  async revokeFamily(family: string, at: Date): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: at },
    });

    return result.count;
  }

  async revokeById(id: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  private toDomain(row: {
    id: string;
    userId: string;
    family: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }): StoredRefreshToken {
    return {
      id: row.id,
      userId: row.userId,
      family: row.family,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }
}
