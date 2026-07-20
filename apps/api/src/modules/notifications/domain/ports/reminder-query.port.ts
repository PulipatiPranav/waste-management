import { type BillingCycle } from '../renewal-schedule';

export interface ActiveSubscriptionForReminder {
  userId: string;
  startDate: Date;
  billingCycle: BillingCycle;
  editionName: string;
}

export interface PendingPickupForReminder {
  userId: string;
  scheduledDate: Date;
}

/**
 * Read-only queries the reminder scans need from other modules' data. It lives behind a port so
 * the notifications module reads subscriptions and pickups without depending on those modules'
 * internals — the Prisma adapter is the only thing that knows the table shapes.
 */
export interface ReminderQuery {
  activeSubscriptions(): Promise<ActiveSubscriptionForReminder[]>;
  /** Pickups scheduled for `date` that are still upcoming (not completed or cancelled). */
  pendingPickupsOn(date: Date): Promise<PendingPickupForReminder[]>;
}

export const REMINDER_QUERY = Symbol('REMINDER_QUERY');
