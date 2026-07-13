import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { OtpChallenge } from '../../domain/entities/otp-challenge';
import {
  type CreateOtpChallengeInput,
  type OtpChallengeRepository,
} from '../../domain/ports/otp-challenge.repository';

@Injectable()
export class PrismaOtpChallengeRepository implements OtpChallengeRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(input: CreateOtpChallengeInput): Promise<OtpChallenge> {
    const row = await this.prisma.otpChallenge.create({
      data: {
        phone: input.phone,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        requestIp: input.requestIp,
      },
    });

    return this.toDomain(row);
  }

  async findLatestByPhone(phone: string): Promise<OtpChallenge | null> {
    const row = await this.prisma.otpChallenge.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });

    return row === null ? null : this.toDomain(row);
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.prisma.otpChallenge.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  /**
   * Conditional update: consume only if not already consumed.
   *
   * `updateMany` with `consumedAt: null` in the WHERE compiles to a single
   * `UPDATE ... WHERE id = $1 AND "consumedAt" IS NULL`, and Postgres serialises
   * concurrent writers to the same row. Two requests arriving with the correct code at
   * the same instant therefore see counts of 1 and 0 — exactly one session is minted.
   *
   * A read-then-write here would let both pass the `isConsumed()` check and both log
   * in, which defeats "single-use" precisely when it matters (a replay attack).
   */
  async consume(id: string, consumedAt: Date): Promise<boolean> {
    const result = await this.prisma.otpChallenge.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt },
    });

    return result.count === 1;
  }

  /**
   * Retires every live challenge for a phone by expiring it.
   *
   * Expiring rather than deleting keeps the row for abuse forensics ("this number was
   * hit 40 times in a minute") while making it unusable.
   */
  async invalidateOutstandingForPhone(phone: string, at: Date): Promise<void> {
    await this.prisma.otpChallenge.updateMany({
      where: { phone, consumedAt: null, expiresAt: { gt: at } },
      data: { expiresAt: at },
    });
  }

  private toDomain(row: {
    id: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
    consumedAt: Date | null;
    attempts: number;
  }): OtpChallenge {
    return OtpChallenge.fromPersistence({
      id: row.id,
      phone: row.phone,
      codeHash: row.codeHash,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      attempts: row.attempts,
      maxAttempts: this.config.get('OTP_MAX_ATTEMPTS', { infer: true }),
    });
  }
}
