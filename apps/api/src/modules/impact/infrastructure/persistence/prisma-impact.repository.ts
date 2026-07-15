import { Injectable } from '@nestjs/common';

import { type PaperType } from '@/modules/wallet/domain/money';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import {
  type ImpactRepository,
  type MonthlyGrams,
  type RecomputedRow,
} from '../../domain/ports/impact.repository';

interface ConfirmedRow {
  userId: string;
  yearMonth: string;
  paperType: PaperType;
  recycledGrams: bigint;
}

@Injectable()
export class PrismaImpactRepository implements ImpactRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The one expensive query in this module, run nightly.
   *
   * A pickup item counts as recycled only when its batch has a CONFIRMED dispatch — the mill
   * weighed it and accepted it. The month is the pickup's completion date (when the customer
   * handed it over), so a customer's "July" is the July they remember, even though the
   * confirmation that unlocks the credit may land in August.
   *
   * Raw SQL because it is a three-table aggregate with a date-truncation, and expressing that
   * through the query builder would be less legible than the SQL it compiles to — and this is
   * the query whose correctness the ESG numbers rest on, so legibility matters most here.
   */
  async recomputeConfirmedRecycling(): Promise<RecomputedRow[]> {
    const rows = await this.prisma.$queryRaw<ConfirmedRow[]>`
      SELECT
        pr."userId"                                        AS "userId",
        to_char(pr."completedAt", 'YYYY-MM')               AS "yearMonth",
        pi."paperType"                                     AS "paperType",
        SUM(pi."weightGrams")::bigint                      AS "recycledGrams"
      FROM "pickup_items" pi
      JOIN "collection_batches" cb ON cb."id" = pi."batchId"
      JOIN "batch_dispatches"  bd ON bd."batchId" = cb."id"
      JOIN "pickup_requests"   pr ON pr."id" = pi."pickupId"
      WHERE bd."status" = 'CONFIRMED'
        AND pr."completedAt" IS NOT NULL
      GROUP BY pr."userId", to_char(pr."completedAt", 'YYYY-MM'), pi."paperType"
    `;

    return rows.map((row) => ({
      userId: row.userId,
      yearMonth: row.yearMonth,
      paperType: row.paperType,
      // The SUM is a bounded aggregate of integer grams; Number is safe well past any real
      // monthly volume, and the cache column is a 32-bit int anyway.
      recycledGrams: Number(row.recycledGrams),
    }));
  }

  /**
   * Swaps the whole cache for a freshly computed set, atomically.
   *
   * Replace-all rather than diff-and-merge: the recompute is the complete truth of what is
   * confirmed-recycled, so anything not in it should not be in the cache (e.g. a batch whose
   * confirmation was corrected). A truncate+insert inside one transaction means a dashboard
   * read during the refresh sees either the old complete set or the new one, never a
   * half-written mix.
   */
  async replaceCache(rows: readonly RecomputedRow[], computedAt: Date): Promise<{ rows: number }> {
    await this.prisma.$transaction(async (tx) => {
      await tx.impactMonthly.deleteMany({});

      if (rows.length > 0) {
        await tx.impactMonthly.createMany({
          data: rows.map((row) => ({
            userId: row.userId,
            yearMonth: row.yearMonth,
            paperType: row.paperType,
            recycledGrams: row.recycledGrams,
            computedAt,
          })),
        });
      }
    });

    return { rows: rows.length };
  }

  async monthlyForUser(userId: string): Promise<MonthlyGrams[]> {
    const rows = await this.prisma.impactMonthly.findMany({
      where: { userId },
      orderBy: [{ yearMonth: 'asc' }],
    });

    return rows.map((row) => this.toMonthly(row));
  }

  async monthlyForUsers(userIds: readonly string[]): Promise<MonthlyGrams[]> {
    if (userIds.length === 0) return [];

    const rows = await this.prisma.impactMonthly.findMany({
      where: { userId: { in: [...userIds] } },
      orderBy: [{ yearMonth: 'asc' }],
    });

    return rows.map((row) => this.toMonthly(row));
  }

  async monthlyForPlatform(): Promise<MonthlyGrams[]> {
    const rows = await this.prisma.impactMonthly.findMany({ orderBy: [{ yearMonth: 'asc' }] });
    return rows.map((row) => this.toMonthly(row));
  }

  async lastComputedAt(): Promise<Date | null> {
    const row = await this.prisma.impactMonthly.findFirst({
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });

    return row?.computedAt ?? null;
  }

  private toMonthly(row: {
    userId: string;
    yearMonth: string;
    paperType: string;
    recycledGrams: number;
  }): MonthlyGrams {
    return {
      userId: row.userId,
      yearMonth: row.yearMonth,
      paperType: row.paperType as PaperType,
      recycledGrams: row.recycledGrams,
    };
  }
}
