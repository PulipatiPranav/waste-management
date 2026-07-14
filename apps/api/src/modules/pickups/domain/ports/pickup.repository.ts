import { type Day } from '@/modules/subscriptions/domain/value-objects/day';
import { type PaperType } from '@/modules/wallet/domain/money';
import { type PickupStatus } from '../pickup-state-machine';

export interface PickupRecord {
  id: string;
  userId: string;
  addressId: string;
  scheduledDate: Day;
  windowStartHour: number;
  windowEndHour: number;
  status: PickupStatus;
  qrToken: string;
  runId: string | null;
  assignedPartnerId: string | null;
  items: {
    paperType: PaperType;
    weightGrams: number;
    ratePerKgPaiseAtPickup: number;
    amountPaise: number;
  }[];
  completedAt: Date | null;
  createdAt: Date;
}

export interface RateCardRecord {
  id: string;
  name: string;
  isActive: boolean;
  rates: { paperType: PaperType; ratePerKgPaise: number }[];
}

/** What the planner needs to slot pickups into delivery runs. */
export interface PlannablePickup {
  id: string;
  pincode: string;
}

export interface PickupRepository {
  create(input: {
    userId: string;
    addressId: string;
    scheduledDate: Day;
    windowStartHour: number;
    windowEndHour: number;
    qrToken: string;
  }): Promise<PickupRecord>;

  findById(id: string): Promise<PickupRecord | null>;
  findByQrToken(token: string): Promise<PickupRecord | null>;
  listForUser(userId: string): Promise<PickupRecord[]>;

  /** Pickups still REQUESTED for a date, with the pincode the planner routes on. */
  listUnassignedForDate(date: Day): Promise<PlannablePickup[]>;

  /** Attaches pickups to a run and flips them to ASSIGNED, in one transaction. */
  assignToRun(
    assignments: readonly { pickupId: string; runId: string; partnerId: string }[],
  ): Promise<number>;

  cancel(id: string): Promise<PickupRecord>;

  listForRun(runId: string): Promise<PickupRecord[]>;

  // --- Rate cards -----------------------------------------------------------

  activeRateCard(): Promise<RateCardRecord | null>;
  listRateCards(): Promise<RateCardRecord[]>;

  /**
   * Creates a card and, if activating it, retires the current one — in one transaction.
   *
   * A partial unique index guarantees at most one active card, so this must deactivate
   * and activate together or the insert is rejected.
   */
  createRateCard(input: {
    name: string;
    rates: { paperType: PaperType; ratePerKgPaise: number }[];
    activate: boolean;
  }): Promise<RateCardRecord>;

  activateRateCard(id: string): Promise<RateCardRecord>;
}

export const PICKUP_REPOSITORY = Symbol('PICKUP_REPOSITORY');
