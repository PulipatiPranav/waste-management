import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ADDRESS_REPOSITORY,
  type AddressRepository,
} from '@/modules/addresses/domain/ports/address.repository';
import {
  CATALOG_REPOSITORY,
  type CatalogRepository,
} from '@/modules/catalog/domain/ports/catalog.repository';
import { isSubscribable, servesPincode } from '@/modules/catalog/domain/catalog.types';
import { CLOCK, type Clock } from '@/modules/auth/domain/ports/clock.port';
import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type BillingCycle, type Subscription } from '../domain/entities/subscription';
import {
  BackdatedChangeError,
  DuplicateSubscriptionError,
  EditionNotFoundError,
  EditionUnavailableError,
  PincodeNotServicedError,
  SubscriptionNotFoundError,
} from '../domain/errors/subscription.errors';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
} from '../domain/ports/subscription.repository';
import {
  billingPeriodFor,
  calculateProration,
  type ProrationResult,
} from '../domain/services/proration.service';
import { Day } from '../domain/value-objects/day';
import { type DeliveryFrequency } from '../domain/value-objects/delivery-frequency';

export interface CreateSubscriptionCommand {
  userId: string;
  editionId: string;
  deliveryAddressId: string;
  frequency: DeliveryFrequency;
  billingCycle: BillingCycle;
  /** Defaults to today. Never in the past — see the backdating guard. */
  startDate?: Day | undefined;
}

@Injectable()
export class SubscriptionUseCases {
  private readonly logger = new Logger(SubscriptionUseCases.name);

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subscriptions: SubscriptionRepository,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    @Inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Create --------------------------------------------------------------

  async create(command: CreateSubscriptionCommand): Promise<Subscription> {
    const today = this.today();
    const startDate = command.startDate ?? today;

    // A subscription cannot start in the past. Backdating would mean issuing charges
    // for issues that were never delivered — nobody printed a paper for a customer who
    // did not exist yet.
    if (startDate.isBefore(today)) {
      throw new BackdatedChangeError('A subscription cannot start in the past.');
    }

    const edition = await this.catalog.findEditionById(command.editionId);

    if (edition === null) {
      throw new EditionNotFoundError();
    }

    if (!isSubscribable(edition)) {
      throw new EditionUnavailableError();
    }

    const address = await this.loadOwnedAddress(command.userId, command.deliveryAddressId);

    // The delivery footprint check. Without it a customer in a pincode no van visits
    // subscribes happily, is billed happily, and receives nothing — the worst possible
    // failure, because it looks like success to everyone until they complain.
    if (!servesPincode(edition, address.pincode)) {
      throw new PincodeNotServicedError(address.pincode);
    }

    const existing = await this.subscriptions.findLiveForUserAndEdition(
      command.userId,
      command.editionId,
    );

    if (existing !== null) {
      throw new DuplicateSubscriptionError();
    }

    const subscription = await this.subscriptions.create({
      userId: command.userId,
      editionId: command.editionId,
      deliveryAddressId: command.deliveryAddressId,
      frequency: command.frequency,
      billingCycle: command.billingCycle,
      startDate,
      // COPIED, not referenced. A later price rise must not silently re-bill this
      // customer, and every invoice must recompute to the figure it was issued at.
      pricePerIssuePaiseAtSubscription: edition.pricePerIssuePaise,
    });

    this.logger.log(`Subscription ${subscription.id} created for edition ${command.editionId}`);

    return subscription;
  }

  // --- Read ----------------------------------------------------------------

  list(userId: string): Promise<Subscription[]> {
    return this.subscriptions.listForUser(userId);
  }

  get(userId: string, id: string): Promise<Subscription> {
    return this.loadOwned(userId, id);
  }

  // --- Lifecycle -----------------------------------------------------------
  //
  // Every one of these asks the STATE MACHINE whether the move is legal, and none of
  // them re-derives that from a status comparison.

  async pause(userId: string, id: string): Promise<Subscription> {
    const subscription = await this.loadOwned(userId, id);
    const status = subscription.assertCanPause();

    // Paused from TODAY, not from an arbitrary date. Backdating a pause would credit
    // issues the customer has already had delivered and read.
    return this.subscriptions.pause(id, status, this.today());
  }

  async resume(userId: string, id: string): Promise<Subscription> {
    const subscription = await this.loadOwned(userId, id);
    const status = subscription.assertCanResume();

    return this.subscriptions.resume(id, status, this.today());
  }

  async cancel(userId: string, id: string): Promise<Subscription> {
    const subscription = await this.loadOwned(userId, id);
    const status = subscription.assertCanCancel();

    // The cancellation day is still billable — the customer receives that morning's
    // paper. calculateProration treats `cancelledOn` as inclusive for exactly this
    // reason.
    return this.subscriptions.cancel(id, status, this.today());
  }

  async changeAddress(
    userId: string,
    id: string,
    deliveryAddressId: string,
  ): Promise<Subscription> {
    const subscription = await this.loadOwned(userId, id);
    subscription.assertCanChangeAddress();

    const address = await this.loadOwnedAddress(userId, deliveryAddressId);
    const edition = await this.catalog.findEditionById(subscription.editionId);

    if (edition === null) {
      throw new EditionNotFoundError();
    }

    // The same footprint check as at signup. Moving house to an unserviced pincode must
    // fail loudly here, rather than turning into a subscription that silently stops
    // being deliverable.
    if (!servesPincode(edition, address.pincode)) {
      throw new PincodeNotServicedError(address.pincode);
    }

    return this.subscriptions.changeAddress(id, deliveryAddressId);
  }

  // --- Billing preview -----------------------------------------------------

  /**
   * What this subscription costs for the period containing `on` (default: today).
   *
   * A preview, not an invoice: nothing is persisted and no money moves. Invoicing
   * proper is Phase 4's problem. This exists so the customer can see, before they
   * commit, that subscribing on the 17th costs them 15 issues and not a full month.
   */
  async previewCharge(userId: string, id: string, on?: Day): Promise<ProrationResult> {
    const subscription = await this.loadOwned(userId, id);
    const day = on ?? this.today();

    return calculateProration({
      period: billingPeriodFor(day, subscription.billingCycle),
      frequency: subscription.frequency,
      pricePerIssuePaise: subscription.pricePerIssuePaise,
      startDate: subscription.startDate,
      cancelledOn: subscription.cancelledOn,
      pauses: subscription.pauses,
    });
  }

  /** The same calculation, for an edition the customer has not subscribed to yet. */
  async quote(
    editionId: string,
    frequency: DeliveryFrequency,
    billingCycle: BillingCycle,
    startDate?: Day,
  ): Promise<ProrationResult> {
    const edition = await this.catalog.findEditionById(editionId);

    if (edition === null) {
      throw new EditionNotFoundError();
    }

    const start = startDate ?? this.today();

    return calculateProration({
      period: billingPeriodFor(start, billingCycle),
      frequency,
      pricePerIssuePaise: edition.pricePerIssuePaise,
      startDate: start,
      cancelledOn: null,
      pauses: [],
    });
  }

  // --- Helpers -------------------------------------------------------------

  private today(): Day {
    return Day.fromUtcDate(this.clock.now());
  }

  /**
   * Load-then-authorise, in one place every path goes through.
   *
   * 404 rather than 403 when the subscription belongs to someone else: a 403 would
   * confirm the id is real and let an attacker enumerate subscription ids.
   */
  private async loadOwned(userId: string, id: string): Promise<Subscription> {
    const subscription = await this.subscriptions.findById(id);

    if (!subscription?.isOwnedBy(userId)) {
      throw new SubscriptionNotFoundError();
    }

    return subscription;
  }

  /** Same rule for the address: a customer cannot deliver a paper to someone else's flat. */
  private async loadOwnedAddress(userId: string, addressId: string): Promise<{ pincode: string }> {
    const address = await this.addresses.findById(addressId);

    if (!address?.isOwnedByUser(userId)) {
      throw new NotFoundError('Address not found');
    }

    return address.toPublic();
  }
}
