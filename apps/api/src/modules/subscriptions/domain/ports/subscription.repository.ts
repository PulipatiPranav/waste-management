import { type Subscription, type BillingCycle } from '../entities/subscription';
import { type SubscriptionStatus } from '../subscription-state-machine';
import { type Day } from '../value-objects/day';
import { type DeliveryFrequency } from '../value-objects/delivery-frequency';

export interface CreateSubscriptionInput {
  userId: string;
  editionId: string;
  deliveryAddressId: string;
  frequency: DeliveryFrequency;
  billingCycle: BillingCycle;
  startDate: Day;
  pricePerIssuePaiseAtSubscription: number;
}

export interface SubscriptionRepository {
  create(input: CreateSubscriptionInput): Promise<Subscription>;

  findById(id: string): Promise<Subscription | null>;

  listForUser(userId: string): Promise<Subscription[]>;

  /** Guards the duplicate-subscription rule: one live subscription per edition per user. */
  findLiveForUserAndEdition(userId: string, editionId: string): Promise<Subscription | null>;

  /**
   * Sets the status and opens a pause window, atomically.
   *
   * One call, one transaction. Two separate writes could leave a subscription marked
   * PAUSED with no pause window — and the next invoice would then bill it in full,
   * because billing reads the windows, not the status.
   */
  pause(id: string, status: SubscriptionStatus, pausedFrom: Day): Promise<Subscription>;

  /** Sets the status and closes the open pause window, atomically. Same reasoning. */
  resume(id: string, status: SubscriptionStatus, resumedFrom: Day): Promise<Subscription>;

  /**
   * Cancels, and closes any open pause window at the cancellation date.
   *
   * Leaving a pause open past cancellation would let it keep accruing credit against a
   * subscription that no longer exists.
   */
  cancel(id: string, status: SubscriptionStatus, cancelledOn: Day): Promise<Subscription>;

  changeAddress(id: string, deliveryAddressId: string): Promise<Subscription>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
