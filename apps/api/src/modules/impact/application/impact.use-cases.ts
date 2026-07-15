import { Inject, Injectable, Logger } from '@nestjs/common';

import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type PaperType } from '@/modules/wallet/domain/money';
import {
  IMPACT_REPOSITORY,
  ORG_MEMBERSHIP_RESOLVER,
  type ImpactRepository,
  type MonthlyGrams,
  type OrgMembershipResolver,
} from '../domain/ports/impact.repository';
import {
  calculateImpact,
  IMPACT_METHODOLOGY,
  type EstimatedImpact,
  type RecycledGramsByType,
} from '../domain/sustainability-factors';

/** One month of the trend: the grams that produced it, and the estimated impact. */
export interface MonthlyImpact {
  yearMonth: string;
  recycledGramsByType: RecycledGramsByType;
  impact: EstimatedImpact;
}

export interface ImpactReport {
  /** Lifetime totals — the headline figures. */
  lifetime: EstimatedImpact;
  /** Oldest month first, so a client can draw a trend line without re-sorting. */
  monthly: MonthlyImpact[];
  /** When the underlying cache was last refreshed. Null if never. */
  computedAt: Date | null;
  /** The provenance of every figure, so a reader can weigh how much to trust each. */
  methodology: typeof IMPACT_METHODOLOGY;
}

@Injectable()
export class ImpactUseCases {
  private readonly logger = new Logger(ImpactUseCases.name);

  constructor(
    @Inject(IMPACT_REPOSITORY) private readonly impact: ImpactRepository,
    @Inject(ORG_MEMBERSHIP_RESOLVER) private readonly orgMembership: OrgMembershipResolver,
  ) {}

  // --- Nightly refresh ------------------------------------------------------

  /**
   * Recomputes the whole impact cache from confirmed-recycled pickups.
   *
   * Called by the nightly job, and exposed to ops so a dashboard can be forced fresh after a
   * weighbridge correction rather than waiting until 03:00.
   */
  async refreshCache(): Promise<{ rows: number }> {
    const rows = await this.impact.recomputeConfirmedRecycling();
    const result = await this.impact.replaceCache(rows, new Date());

    this.logger.log(`Impact cache refreshed: ${result.rows} (user, month, paper-type) row(s).`);

    return result;
  }

  // --- Reads (cheap; served from the cache) ---------------------------------

  async forUser(userId: string): Promise<ImpactReport> {
    return this.buildReport(await this.impact.monthlyForUser(userId));
  }

  async forApartment(apartmentId: string): Promise<ImpactReport> {
    // Empty until Phase 7 wires org membership — the report then correctly reads zero rather
    // than erroring. See EmptyOrgMembershipResolver.
    const userIds = await this.orgMembership.usersInApartment(apartmentId);
    return this.buildReport(await this.impact.monthlyForUsers(userIds));
  }

  async forBusiness(businessId: string): Promise<ImpactReport> {
    const userIds = await this.orgMembership.usersInBusiness(businessId);
    return this.buildReport(await this.impact.monthlyForUsers(userIds));
  }

  async forPlatform(): Promise<ImpactReport> {
    return this.buildReport(await this.impact.monthlyForPlatform());
  }

  // --- Assembly -------------------------------------------------------------

  /**
   * Turns cached monthly grams into a report.
   *
   * Impact is DERIVED here, at read time, from cached grams — never cached itself. So the day
   * someone re-verifies a conversion factor against a new WARM version, every dashboard
   * reflects it on the next read, with no stale CO2 figures to invalidate. Same reasoning as
   * deriving a wallet balance from its ledger rather than trusting a frozen number.
   */
  private async buildReport(rows: MonthlyGrams[]): Promise<ImpactReport> {
    const byMonth = new Map<string, RecycledGramsByType>();
    const lifetimeGrams: RecycledGramsByType = {};

    for (const row of rows) {
      const month = byMonth.get(row.yearMonth) ?? {};
      month[row.paperType] = (month[row.paperType] ?? 0) + row.recycledGrams;
      byMonth.set(row.yearMonth, month);

      lifetimeGrams[row.paperType] = (lifetimeGrams[row.paperType] ?? 0) + row.recycledGrams;
    }

    const monthly: MonthlyImpact[] = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([yearMonth, gramsByType]) => ({
        yearMonth,
        recycledGramsByType: gramsByType,
        impact: calculateImpact(gramsByType),
      }));

    return {
      // Lifetime is computed from the FULL lifetime grams in one pass, not by summing the
      // per-month impacts — identical by additivity, but this keeps rounding out of the total.
      lifetime: calculateImpact(lifetimeGrams),
      monthly,
      computedAt: await this.impact.lastComputedAt(),
      methodology: IMPACT_METHODOLOGY,
    };
  }
}

export type { PaperType, EstimatedImpact };

/** Guards the staff lookup: a user must exist to have an impact report. */
export class ImpactUserNotFound extends NotFoundError {
  override readonly code = 'USER_NOT_FOUND';
  constructor() {
    super('User not found');
  }
}
