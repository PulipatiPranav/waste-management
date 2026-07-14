import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  ADDRESS_REPOSITORY,
  type AddressRepository,
} from '@/modules/addresses/domain/ports/address.repository';
import { CLOCK, type Clock } from '@/modules/auth/domain/ports/clock.port';
import {
  DELIVERY_REPOSITORY,
  type DeliveryRepository,
} from '@/modules/delivery/domain/ports/delivery.repository';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { calculateCashback, type PaperType } from '@/modules/wallet/domain/money';
import {
  WALLET_REPOSITORY,
  type CompletedPickupResult,
  type WalletRepository,
} from '@/modules/wallet/domain/ports/wallet.repository';
import {
  ConflictError,
  InvariantViolationError,
  NotFoundError,
} from '@/shared/domain/errors/domain.error';
import { applyPickupTransition } from '../domain/pickup-state-machine';
import {
  PICKUP_REPOSITORY,
  type PickupRecord,
  type PickupRepository,
  type RateCardRecord,
} from '../domain/ports/pickup.repository';
import {
  WEIGHING_DEVICE_READER,
  type RawWeightInput,
  type WeighingDeviceReader,
} from '../domain/ports/weighing-device.port';

@Injectable()
export class PickupUseCases {
  private readonly logger = new Logger(PickupUseCases.name);

  constructor(
    @Inject(PICKUP_REPOSITORY) private readonly pickups: PickupRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallet: WalletRepository,
    @Inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository,
    @Inject(DELIVERY_REPOSITORY) private readonly delivery: DeliveryRepository,
    @Inject(WEIGHING_DEVICE_READER) private readonly scale: WeighingDeviceReader,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Customer -------------------------------------------------------------

  async request(input: {
    userId: string;
    addressId: string;
    scheduledDate: Day;
    windowStartHour: number;
    windowEndHour: number;
  }): Promise<PickupRecord> {
    const today = Day.fromUtcDate(this.clock.now());

    // No backdating: a pickup in the past is a pickup nobody can be dispatched to, and it
    // would be swept up by tomorrow's planner into a run for a date that has been.
    if (input.scheduledDate.isBefore(today)) {
      throw new InvariantViolationError('A pickup cannot be scheduled in the past.');
    }

    const address = await this.addresses.findById(input.addressId);

    if (!address?.isOwnedByUser(input.userId)) {
      throw new NotFoundError('Address not found');
    }

    // 256 bits from the CSPRNG. This token is what authorises a partner to weigh paper
    // against this customer's wallet, so a guessable one would let anyone collect a
    // stranger's cashback. Never `Math.random()`.
    const qrToken = randomBytes(32).toString('base64url');

    const pickup = await this.pickups.create({
      userId: input.userId,
      addressId: input.addressId,
      scheduledDate: input.scheduledDate,
      windowStartHour: input.windowStartHour,
      windowEndHour: input.windowEndHour,
      qrToken,
    });

    this.logger.log(`Pickup ${pickup.id} requested for ${input.scheduledDate.toString()}`);

    return pickup;
  }

  list(userId: string): Promise<PickupRecord[]> {
    return this.pickups.listForUser(userId);
  }

  async get(userId: string, id: string): Promise<PickupRecord> {
    return this.loadOwned(userId, id);
  }

  async cancel(userId: string, id: string): Promise<PickupRecord> {
    const pickup = await this.loadOwned(userId, id);

    // Throws on COMPLETED: the wallet has already been credited and the ledger is
    // append-only, so "cancelling" it could only mean clawing cashback back.
    applyPickupTransition(pickup.status, 'CANCEL');

    return this.pickups.cancel(id);
  }

  // --- Partner --------------------------------------------------------------

  /**
   * The partner scans the QR code at the customer's door.
   *
   * Two things are checked, and both matter:
   *   - the token is real (it is 256 bits, so it cannot be guessed), AND
   *   - the pickup is assigned to THIS partner.
   *
   * The token alone is not authorisation. A partner who photographed a colleague's
   * customer's QR code could otherwise weigh paper into that customer's pickup and — more
   * to the point — a stolen token would be a way to trigger arbitrary wallet credits.
   */
  async scan(
    userId: string,
    qrToken: string,
  ): Promise<PickupRecord & { rateCard: RateCardRecord }> {
    const partner = await this.requirePartner(userId);
    const pickup = await this.pickups.findByQrToken(qrToken);

    if (pickup?.assignedPartnerId !== partner.id) {
      // Same error either way: a partner must not be able to probe which QR tokens exist.
      throw new NotFoundError('Pickup not found, or not assigned to you.');
    }

    if (pickup.status !== 'ASSIGNED') {
      throw new ConflictError(`This pickup is ${pickup.status} and cannot be collected.`);
    }

    const rateCard = await this.requireActiveRateCard();

    return { ...pickup, rateCard };
  }

  /**
   * Weigh the paper and pay the customer. THE core transaction of the product.
   *
   * Everything that must be true together — the pickup is completed, the items are
   * recorded, the ledger gains exactly one entry, the balance moves — happens inside a
   * single database transaction in the repository. This method's job is the
   * authorisation and validation that must happen BEFORE it.
   *
   * It is idempotent at three levels, deliberately:
   *   1. The Idempotency-Key interceptor replays the cached response.
   *   2. The status is claimed with a conditional UPDATE (WHERE status = 'ASSIGNED').
   *   3. `wallet_transactions.pickupId` is UNIQUE.
   * A partner on 2G will double-submit. Any one of these would stop a double credit; all
   * three are here because this is the one place in the product where being wrong means
   * paying real money twice.
   */
  async complete(input: {
    userId: string;
    pickupId: string;
    weights: readonly RawWeightInput[];
  }): Promise<CompletedPickupResult & { rateCardId: string }> {
    const partner = await this.requirePartner(input.userId);
    const pickup = await this.pickups.findById(input.pickupId);

    if (pickup?.assignedPartnerId !== partner.id) {
      throw new NotFoundError('Pickup not found, or not assigned to you.');
    }

    // Fails fast on an already-completed pickup with a clear message. The repository's
    // conditional update is what makes it SAFE under concurrency; this is what makes it
    // COMPREHENSIBLE to the partner staring at their phone.
    applyPickupTransition(pickup.status, 'COMPLETE');

    if (input.weights.length === 0) {
      throw new InvariantViolationError(
        'Record at least one weighed paper type. To collect nothing, cancel the pickup instead.',
      );
    }

    // Validates the numbers: whole grams, positive, plausible. The same checks will run
    // when a Bluetooth scale supplies them — a flaky BLE link reports nonsense too.
    const readings = await this.scale.read(input.weights);

    const rateCard = await this.requireActiveRateCard();
    const rateFor = new Map(rateCard.rates.map((rate) => [rate.paperType, rate.ratePerKgPaise]));

    const items = readings.map((reading) => {
      const rate = rateFor.get(reading.paperType);

      if (rate === undefined) {
        // The active rate card has no price for this paper type. Refuse rather than
        // guessing a rate or defaulting to zero — a silent 0 would mean the customer
        // handed over real paper and was paid nothing.
        throw new InvariantViolationError(
          `The active rate card has no rate for ${reading.paperType}. Ops must add one before this can be collected.`,
        );
      }

      return {
        paperType: reading.paperType,
        weightGrams: reading.weightGrams,
        ratePerKgPaise: rate,
      };
    });

    const result = await this.wallet.completePickupWithCashback({
      pickupId: pickup.id,
      userId: pickup.userId,
      rateCardId: rateCard.id,
      items,
    });

    this.logger.log(
      `Pickup ${pickup.id} completed: ${result.totalWeightGrams} g -> ${result.totalPaise} paise credited`,
    );

    return { ...result, rateCardId: rateCard.id };
  }

  /** What a pickup WOULD pay, at today's rates. Nothing is persisted. */
  async quote(weights: readonly RawWeightInput[]) {
    const readings = await this.scale.read(weights);
    const rateCard = await this.requireActiveRateCard();
    const rateFor = new Map(rateCard.rates.map((rate) => [rate.paperType, rate.ratePerKgPaise]));

    return calculateCashback(
      readings.map((reading) => ({
        paperType: reading.paperType,
        weightGrams: reading.weightGrams,
        ratePerKgPaise: rateFor.get(reading.paperType) ?? 0,
      })),
    );
  }

  // --- Rate cards -----------------------------------------------------------

  activeRateCard(): Promise<RateCardRecord> {
    return this.requireActiveRateCard();
  }

  listRateCards(): Promise<RateCardRecord[]> {
    return this.pickups.listRateCards();
  }

  createRateCard(input: {
    name: string;
    rates: { paperType: PaperType; ratePerKgPaise: number }[];
    activate: boolean;
  }): Promise<RateCardRecord> {
    return this.pickups.createRateCard(input);
  }

  activateRateCard(id: string): Promise<RateCardRecord> {
    return this.pickups.activateRateCard(id);
  }

  // --- Helpers --------------------------------------------------------------

  private async requireActiveRateCard(): Promise<RateCardRecord> {
    const card = await this.pickups.activeRateCard();

    if (card === null) {
      // Refuse loudly. Pricing a pickup with no rate card could only mean inventing a
      // rate, and the customer would be paid a number nobody authorised.
      throw new ConflictError(
        'No active rate card. Ops must publish one before any pickup can be priced.',
      );
    }

    return card;
  }

  private async requirePartner(userId: string) {
    const partner = await this.delivery.findPartnerByUserId(userId);

    if (!partner?.isActive) {
      throw new NotFoundError('You are not an active delivery partner.');
    }

    return partner;
  }

  private async loadOwned(userId: string, id: string): Promise<PickupRecord> {
    const pickup = await this.pickups.findById(id);

    // 404, not 403, on someone else's pickup — a 403 confirms the id is real.
    if (pickup?.userId !== userId) {
      throw new NotFoundError('Pickup not found');
    }

    return pickup;
  }
}
