import { type Day } from '@/modules/subscriptions/domain/value-objects/day';
import {
  type PlannablePartner,
  type PlannableSubscription,
  type PlannableZone,
  type PlannedRun,
} from '../services/run-planner';
import { type StopOutcome, type StopStatus } from '../stop-status';

export interface DeliveryPartnerRecord {
  id: string;
  userId: string;
  name: string | null;
  phone: string;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  vehicleType: string;
  isActive: boolean;
  isAvailable: boolean;
  zoneIds: string[];
}

export interface StopRecord {
  id: string;
  runId: string;
  subscriptionId: string;
  addressId: string;
  status: StopStatus;
  reason: string | null;
  photoKey: string | null;
  sequence: number;
  completedAt: Date | null;
}

export interface RunRecord {
  id: string;
  runDate: Day;
  partnerId: string;
  zoneId: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  stops: StopRecord[];
}

export interface CompletionStats {
  runDate: Day;
  zoneId: string;
  zoneName: string;
  partnerId: string;
  partnerName: string | null;
  total: number;
  delivered: number;
  failed: number;
  skipped: number;
  pending: number;
  /** delivered / total, 0-1. Null when there is nothing to divide by. */
  completionRate: number | null;
}

export interface DeliveryRepository {
  // --- Planner inputs -------------------------------------------------------

  /**
   * Everything the planner needs, for one day, in three reads.
   *
   * Loaded up front and handed to a pure function, rather than having the planner
   * query as it goes — that is what keeps the assignment logic testable without a
   * database, and it is where the interesting bugs live.
   */
  loadPlannableSubscriptions(runDate: Day): Promise<PlannableSubscription[]>;
  loadPlannableZones(): Promise<PlannableZone[]>;
  loadPlannablePartners(): Promise<PlannablePartner[]>;

  /**
   * Persists a plan.
   *
   * Idempotent by construction: `@@unique([runDate, partnerId, zoneId])` means a second
   * execution for the same night collides rather than issuing duplicate run sheets.
   * Returns how many runs were newly created.
   */
  persistPlan(
    runDate: Day,
    runs: readonly PlannedRun[],
  ): Promise<{ created: number; skipped: number }>;

  // --- Partner --------------------------------------------------------------

  findPartnerByUserId(userId: string): Promise<DeliveryPartnerRecord | null>;
  findPartnerById(id: string): Promise<DeliveryPartnerRecord | null>;

  listRunsForPartner(partnerId: string, runDate: Day): Promise<RunRecord[]>;

  findStopById(id: string): Promise<(StopRecord & { partnerId: string }) | null>;

  /**
   * Records an outcome, but ONLY if the stop is still PENDING.
   *
   * A conditional update, not a read-then-write. A delivery partner on a flaky mobile
   * network will double-submit, and two requests racing would otherwise both pass the
   * PENDING check — the second silently overwriting the first's reason and timestamp.
   * Returns null when the stop was already recorded.
   */
  recordOutcome(input: {
    stopId: string;
    outcome: StopOutcome;
    reason: string | null;
    photoKey: string | null;
    at: Date;
  }): Promise<StopRecord | null>;

  attachPhoto(stopId: string, photoKey: string): Promise<void>;

  /** Rolls the run's own status up from its stops (PENDING -> IN_PROGRESS -> COMPLETED). */
  refreshRunStatus(runId: string, at: Date): Promise<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>;

  // --- Admin ----------------------------------------------------------------

  onboardPartner(input: {
    userId: string;
    vehicleType: string;
    zoneIds: string[];
  }): Promise<DeliveryPartnerRecord>;

  updatePartner(
    id: string,
    input: {
      kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
      isActive?: boolean;
      isAvailable?: boolean;
      vehicleType?: string;
      zoneIds?: string[];
    },
  ): Promise<DeliveryPartnerRecord>;

  listPartners(): Promise<DeliveryPartnerRecord[]>;

  findRunById(id: string): Promise<RunRecord | null>;

  /** Moves a whole run to another partner. Refused once any stop has been actioned. */
  reassignRun(runId: string, toPartnerId: string): Promise<RunRecord>;

  completionStats(runDate: Day): Promise<CompletionStats[]>;

  createZone(input: { name: string; city: string; pincodes: string[] }): Promise<PlannableZone>;
  listZones(): Promise<PlannableZone[]>;
}

export const DELIVERY_REPOSITORY = Symbol('DELIVERY_REPOSITORY');
