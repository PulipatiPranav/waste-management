import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { CLOCK, type Clock } from '@/modules/auth/domain/ports/clock.port';
import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/domain/errors/domain.error';
import {
  DELIVERY_EVENT_PUBLISHER,
  type DeliveryEventPublisher,
} from '../domain/ports/delivery-events.port';
import {
  DELIVERY_REPOSITORY,
  type CompletionStats,
  type DeliveryPartnerRecord,
  type DeliveryRepository,
  type RunRecord,
  type StopRecord,
} from '../domain/ports/delivery.repository';
import { STORAGE_PROVIDER, type StorageProvider } from '../domain/ports/storage-provider.port';
import { planRuns, type RunPlan } from '../domain/services/run-planner';
import {
  assertCanRecordOutcome,
  assertReasonMatchesOutcome,
  type StopOutcome,
} from '../domain/stop-status';

/**
 * Plans a day's delivery runs.
 *
 * Called by the nightly BullMQ job, and directly by an admin endpoint so ops can force
 * a re-plan without waiting for 21:00 (or after fixing a zone that had no partners).
 * Idempotent: running it twice does not double-issue run sheets.
 */
@Injectable()
export class PlanDeliveryRunsUseCase {
  private readonly logger = new Logger(PlanDeliveryRunsUseCase.name);

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly delivery: DeliveryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(runDate?: Day): Promise<RunPlan & { created: number; skipped: number }> {
    // Default is TOMORROW: the job runs at night to prepare the morning round.
    const date = runDate ?? Day.fromUtcDate(this.clock.now()).addDays(1);

    const [subscriptions, zones, partners] = await Promise.all([
      this.delivery.loadPlannableSubscriptions(date),
      this.delivery.loadPlannableZones(),
      this.delivery.loadPlannablePartners(),
    ]);

    const plan = planRuns({ runDate: date, subscriptions, zones, partners });

    const { created, skipped } = await this.delivery.persistPlan(date, plan.runs);

    const stops = plan.runs.reduce((sum, run) => sum + run.stops.length, 0);
    this.logger.log(
      `Planned ${date.toString()}: ${created} run(s) created, ${skipped} already existed, ${stops} stop(s).`,
    );

    // Loud, not swallowed. Every unassigned subscription is a customer who will be
    // billed and receive nothing — the failure that looks like success until they call.
    if (plan.unassigned.length > 0) {
      const noZone = plan.unassigned.filter((u) => u.reason === 'NO_ZONE').length;
      const noPartner = plan.unassigned.filter((u) => u.reason === 'NO_PARTNER').length;

      this.logger.error(
        `${plan.unassigned.length} subscription(s) could not be assigned for ${date.toString()}: ` +
          `${noZone} with no zone covering their pincode, ${noPartner} in a zone with no available ` +
          `KYC-verified partner. These customers will receive no paper. Pincodes: ` +
          `${[...new Set(plan.unassigned.map((u) => u.pincode))].join(', ')}`,
      );
    }

    if (plan.ambiguousPincodes.length > 0) {
      this.logger.warn(
        `Pincode(s) in more than one active zone: ${plan.ambiguousPincodes.join(', ')}. ` +
          `Assignment picked one deterministically, but ops should fix the overlap.`,
      );
    }

    return { ...plan, created, skipped };
  }
}

@Injectable()
export class PartnerDeliveryUseCases {
  private readonly logger = new Logger(PartnerDeliveryUseCases.name);

  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly delivery: DeliveryRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(DELIVERY_EVENT_PUBLISHER) private readonly events: DeliveryEventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The partner's own runs for a day. Defaults to today. */
  async myRuns(
    userId: string,
    on?: Day,
  ): Promise<{ partner: DeliveryPartnerRecord; runs: RunRecord[] }> {
    const partner = await this.requirePartner(userId);
    const date = on ?? Day.fromUtcDate(this.clock.now());

    return { partner, runs: await this.delivery.listRunsForPartner(partner.id, date) };
  }

  /**
   * Record a delivery outcome.
   *
   * The two guards that matter: the stop must belong to THIS partner (a partner must
   * not be able to mark another partner's customer delivered), and it must still be
   * PENDING (recorded once, no rewriting history).
   */
  async recordOutcome(input: {
    userId: string;
    stopId: string;
    outcome: StopOutcome;
    reason: string | null;
    photoKey: string | null;
  }): Promise<StopRecord> {
    const partner = await this.requirePartner(input.userId);
    const stop = await this.requireOwnStop(partner.id, input.stopId);

    // Domain rules, checked before the write: recorded-once, and FAILED/SKIPPED must
    // say why. Both are also DB check constraints — application-only enforcement is one
    // bad write path away from being untrue, DB-only surfaces as a 500.
    assertCanRecordOutcome(stop.status, input.outcome);
    assertReasonMatchesOutcome(input.outcome, input.reason);

    const now = this.clock.now();

    const updated = await this.delivery.recordOutcome({
      stopId: stop.id,
      outcome: input.outcome,
      reason: input.reason?.trim() ?? null,
      photoKey: input.photoKey,
      at: now,
    });

    // The conditional UPDATE matched nothing, so another request beat us to it — a
    // double-submit from a partner on a flaky network. Report it as the same conflict
    // the state machine would have raised, rather than pretending it succeeded.
    if (updated === null) {
      const current = await this.delivery.findStopById(stop.id);
      throw new ConflictError(
        `This delivery has already been recorded as ${current?.status ?? 'actioned'}.`,
      );
    }

    const runStatus = await this.delivery.refreshRunStatus(stop.runId, now);
    const run = await this.delivery.findRunById(stop.runId);

    this.events.stopStatusChanged({
      stopId: updated.id,
      runId: updated.runId,
      partnerId: partner.id,
      zoneId: run?.zoneId ?? '',
      subscriptionId: updated.subscriptionId,
      status: updated.status,
      reason: updated.reason,
      runStatus,
      at: now.toISOString(),
    });

    return updated;
  }

  /**
   * Store a proof photo and attach it to the stop.
   *
   * Separate from recording the outcome on purpose. A partner on a bad connection can
   * upload the photo when they get signal and submit the outcome separately — and in
   * Phase 13 the offline queue can retry each independently. Coupling them would mean a
   * failed 3MB upload loses the delivery record too.
   */
  async attachPhoto(input: {
    userId: string;
    stopId: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ photoKey: string }> {
    const partner = await this.requirePartner(input.userId);
    const stop = await this.requireOwnStop(partner.id, input.stopId);

    const extension = input.contentType === 'image/png' ? 'png' : 'jpg';
    // Key is derived server-side from ids we control. Nothing from the client's
    // filename reaches the storage key — that is how path traversal gets in.
    const key = `delivery-proof/${stop.runId}/${stop.id}.${extension}`;

    await this.storage.put({ key, body: input.body, contentType: input.contentType });
    await this.delivery.attachPhoto(stop.id, key);

    this.logger.log(`Proof photo attached to stop ${stop.id}`);

    return { photoKey: key };
  }

  /** A short-lived signed URL. Proof photos show inside customers' doorways. */
  signedPhotoUrl(key: string): Promise<string> {
    return this.storage.getSignedUrl(
      key,
      this.config.get('STORAGE_SIGNED_URL_TTL_SECONDS', { infer: true }),
    );
  }

  private async requirePartner(userId: string): Promise<DeliveryPartnerRecord> {
    const partner = await this.delivery.findPartnerByUserId(userId);

    if (partner === null) {
      throw new NotFoundError('You are not onboarded as a delivery partner.');
    }

    if (!partner.isActive) {
      throw new ForbiddenError('Your delivery partner account is not active.');
    }

    return partner;
  }

  /**
   * 404, not 403, on another partner's stop — a 403 would confirm the id is real and
   * let a partner enumerate the round sheets of everyone else in the city.
   */
  private async requireOwnStop(
    partnerId: string,
    stopId: string,
  ): Promise<StopRecord & { partnerId: string }> {
    const stop = await this.delivery.findStopById(stopId);

    if (stop?.partnerId !== partnerId) {
      throw new NotFoundError('Delivery not found');
    }

    return stop;
  }
}

@Injectable()
export class AdminDeliveryUseCases {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly delivery: DeliveryRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onboardPartner(input: {
    userId: string;
    vehicleType: string;
    zoneIds: string[];
  }): Promise<DeliveryPartnerRecord> {
    const user = await this.users.findById(input.userId);

    if (user === null) {
      throw new NotFoundError('User not found');
    }

    // The role is the authorisation fact the guard reads on every request; the
    // DeliveryPartner row is just the profile. Onboarding someone whose role is still
    // CUSTOMER would create a partner who cannot call a single partner endpoint — a
    // confusing half-state, so refuse it and make ops set the role first.
    if (user.role !== 'DELIVERY_PARTNER') {
      throw new ConflictError(
        `This user's role is ${user.role}. Set it to DELIVERY_PARTNER before onboarding them.`,
      );
    }

    const existing = await this.delivery.findPartnerByUserId(input.userId);

    if (existing !== null) {
      throw new ConflictError('This user is already onboarded as a delivery partner.');
    }

    return this.delivery.onboardPartner(input);
  }

  listPartners(): Promise<DeliveryPartnerRecord[]> {
    return this.delivery.listPartners();
  }

  async updatePartner(
    id: string,
    input: {
      kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
      isActive?: boolean;
      isAvailable?: boolean;
      vehicleType?: string;
      zoneIds?: string[];
    },
  ): Promise<DeliveryPartnerRecord> {
    const partner = await this.delivery.findPartnerById(id);

    if (partner === null) {
      throw new NotFoundError('Delivery partner not found');
    }

    return this.delivery.updatePartner(id, input);
  }

  async reassignRun(runId: string, toPartnerId: string): Promise<RunRecord> {
    const run = await this.delivery.findRunById(runId);

    if (run === null) {
      throw new NotFoundError('Delivery run not found');
    }

    const target = await this.delivery.findPartnerById(toPartnerId);

    if (target === null) {
      throw new NotFoundError('Delivery partner not found');
    }

    // The same eligibility bar the planner applies. Reassignment must not be a back
    // door around KYC — handing an unverified partner a list of customers' addresses is
    // exactly what the planner refuses to do.
    if (!target.isActive || target.kycStatus !== 'VERIFIED') {
      throw new ConflictError(
        'That partner is not active and KYC-verified, so they cannot be given a run.',
      );
    }

    if (!target.zoneIds.includes(run.zoneId)) {
      throw new ConflictError('That partner does not work the zone this run covers.');
    }

    return this.delivery.reassignRun(runId, toPartnerId);
  }

  completionStats(on?: Day): Promise<CompletionStats[]> {
    return this.delivery.completionStats(on ?? Day.fromUtcDate(this.clock.now()));
  }

  createZone(input: { name: string; city: string; pincodes: string[] }) {
    return this.delivery.createZone(input);
  }

  listZones() {
    return this.delivery.listZones();
  }

  async runById(id: string): Promise<RunRecord> {
    const run = await this.delivery.findRunById(id);

    if (run === null) {
      throw new NotFoundError('Delivery run not found');
    }

    return run;
  }
}
