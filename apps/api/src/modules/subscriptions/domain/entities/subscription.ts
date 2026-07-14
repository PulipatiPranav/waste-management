import { applyTransition, type SubscriptionStatus } from '../subscription-state-machine';
import { type PauseWindow } from '../services/proration.service';
import { type Day } from '../value-objects/day';
import { type DeliveryFrequency } from '../value-objects/delivery-frequency';

export type BillingCycle = 'MONTHLY' | 'QUARTERLY';

export interface SubscriptionProps {
  id: string;
  userId: string;
  editionId: string;
  deliveryAddressId: string;
  status: SubscriptionStatus;
  frequency: DeliveryFrequency;
  billingCycle: BillingCycle;
  startDate: Day;
  cancelledOn: Day | null;
  pricePerIssuePaiseAtSubscription: number;
  pauses: readonly PauseWindow[];
  createdAt: Date;
}

export class Subscription {
  private constructor(private readonly props: SubscriptionProps) {}

  static fromPersistence(props: SubscriptionProps): Subscription {
    return new Subscription(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get editionId(): string {
    return this.props.editionId;
  }

  get deliveryAddressId(): string {
    return this.props.deliveryAddressId;
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  get frequency(): DeliveryFrequency {
    return this.props.frequency;
  }

  get billingCycle(): BillingCycle {
    return this.props.billingCycle;
  }

  get startDate(): Day {
    return this.props.startDate;
  }

  get cancelledOn(): Day | null {
    return this.props.cancelledOn;
  }

  get pricePerIssuePaise(): number {
    return this.props.pricePerIssuePaiseAtSubscription;
  }

  get pauses(): readonly PauseWindow[] {
    return this.props.pauses;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /**
   * The only authorisation question for this resource. Every read and write goes
   * through it, so "can customer A touch customer B's subscription?" is answered once.
   */
  isOwnedBy(userId: string): boolean {
    return this.props.userId === userId;
  }

  // --- Transitions ---------------------------------------------------------
  //
  // Each one delegates the legality question to the state machine and NEVER re-derives
  // it from a status comparison. That is the difference between one table to audit and
  // five scattered `if`s to keep in sync.

  /** @throws {InvalidTransitionError} */
  assertCanPause(): SubscriptionStatus {
    return applyTransition(this.props.status, 'PAUSE');
  }

  /** @throws {InvalidTransitionError} */
  assertCanResume(): SubscriptionStatus {
    return applyTransition(this.props.status, 'RESUME');
  }

  /** @throws {InvalidTransitionError} */
  assertCanCancel(): SubscriptionStatus {
    return applyTransition(this.props.status, 'CANCEL');
  }

  /** @throws {InvalidTransitionError} */
  assertCanChangeAddress(): SubscriptionStatus {
    return applyTransition(this.props.status, 'CHANGE_ADDRESS');
  }
}
