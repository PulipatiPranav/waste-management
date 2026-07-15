import { type PaperType } from '@/modules/wallet/domain/money';

/** Recycled grams for one user, one month, one paper type — a cached ImpactMonthly row. */
export interface MonthlyGrams {
  userId: string;
  yearMonth: string;
  paperType: PaperType;
  recycledGrams: number;
}

/** The recompute the nightly job hands back to the store: fresh grams per (user, month, type). */
export interface RecomputedRow {
  userId: string;
  yearMonth: string;
  paperType: PaperType;
  recycledGrams: number;
}

export interface ImpactRepository {
  /**
   * Scans confirmed-recycled pickup items and returns grams per (user, month, paper type).
   *
   * "Confirmed-recycled" is the defensible unit: a pickup item counts only once its
   * CollectionBatch has a BatchDispatch the mill CONFIRMED. Paper we collected but that a mill
   * has not yet weighed and accepted is not something we can claim environmental credit for —
   * claiming it would be counting recycling that has not happened.
   *
   * The EXPENSIVE query. It is why the ImpactMonthly cache exists; this runs nightly, not per
   * request.
   */
  recomputeConfirmedRecycling(): Promise<RecomputedRow[]>;

  /** Replaces the cache with a freshly recomputed set, in one transaction. */
  replaceCache(rows: readonly RecomputedRow[], computedAt: Date): Promise<{ rows: number }>;

  /** Cached monthly grams for one user. The read path — cheap. */
  monthlyForUser(userId: string): Promise<MonthlyGrams[]>;

  /** Cached monthly grams summed across a set of users (an org, or the platform). */
  monthlyForUsers(userIds: readonly string[]): Promise<MonthlyGrams[]>;

  /** Every user's cached monthly grams — the platform total. */
  monthlyForPlatform(): Promise<MonthlyGrams[]>;

  /** When the cache was last refreshed, so a dashboard can say "as of" honestly. */
  lastComputedAt(): Promise<Date | null>;
}

export const IMPACT_REPOSITORY = Symbol('IMPACT_REPOSITORY');

/**
 * Resolves which users belong to an apartment or business.
 *
 * A SEAM, deliberately. Org membership does not exist until Phase 7 — apartments and
 * businesses are tables with no members yet — so today this returns an empty list and the
 * org dashboards correctly report zero. When Phase 7 adds membership, it implements this port
 * and the org dashboards light up with no change to the impact engine.
 *
 * Impact is defined as the sum over an org's member users, NOT over "addresses linked to the
 * org": a customer's recycling is theirs, and rolls up to their org, wherever they dropped
 * the paper. That is the only definition that stays correct when a resident moves flats.
 */
export interface OrgMembershipResolver {
  usersInApartment(apartmentId: string): Promise<string[]>;
  usersInBusiness(businessId: string): Promise<string[]>;
}

export const ORG_MEMBERSHIP_RESOLVER = Symbol('ORG_MEMBERSHIP_RESOLVER');
