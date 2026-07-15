import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  DELIVERY_REPOSITORY,
  type DeliveryRepository,
} from '@/modules/delivery/domain/ports/delivery.repository';
import { CLOCK, type Clock } from '@/modules/auth/domain/ports/clock.port';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { PICKUP_REPOSITORY, type PickupRepository } from '../domain/ports/pickup.repository';

export interface PickupAssignmentResult {
  date: Day;
  assigned: number;
  unassigned: { pickupId: string; pincode: string; reason: 'NO_RUN_IN_ZONE' }[];
  /** Runs created for zones that had pickups but no delivery round that day. */
  pickupOnlyRunsCreated: number;
}

/**
 * Slots the day's pickups into the delivery runs the planner already created.
 *
 * Pickups ride along with the delivery round rather than getting their own dispatch: the
 * partner is already walking that street with the morning papers, and sending a second
 * person to collect the old ones would double the cost of the entire circular model. That
 * co-location is the whole economic argument for the product.
 *
 * Runs AFTER the delivery planner, in the same nightly job, because it needs the runs to
 * exist. Idempotent: assignment is a conditional update on `status = 'REQUESTED'`, so a
 * re-run cannot re-route a pickup a partner is already standing in front of.
 */
@Injectable()
export class AssignPickupsToRunsUseCase {
  private readonly logger = new Logger(AssignPickupsToRunsUseCase.name);

  constructor(
    @Inject(PICKUP_REPOSITORY) private readonly pickups: PickupRepository,
    @Inject(DELIVERY_REPOSITORY) private readonly delivery: DeliveryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(on?: Day): Promise<PickupAssignmentResult> {
    const date = on ?? Day.fromUtcDate(this.clock.now()).addDays(1);

    const [pending, zones, runs, partners] = await Promise.all([
      this.pickups.listUnassignedForDate(date),
      this.delivery.loadPlannableZones(),
      this.delivery.listRunsForDate(date),
      this.delivery.loadPlannablePartners(),
    ]);

    if (pending.length === 0) {
      return { date, assigned: 0, unassigned: [], pickupOnlyRunsCreated: 0 };
    }

    // Same eligibility bar the delivery planner uses: active, available, KYC-verified. A
    // pickup-only run must not hand a customer's address to an unvetted partner any more
    // than a delivery run would.
    const eligiblePartners = partners.filter(
      (partner) => partner.isActive && partner.isAvailable && partner.kycStatus === 'VERIFIED',
    );

    // Which runs cover which zone. A zone can have several runs (several partners); the
    // pickup goes to the least-loaded, so one partner does not end up carrying every
    // pickup in the area on top of a full delivery round.
    const runsByZone = new Map<string, { id: string; partnerId: string }[]>();

    for (const run of runs) {
      const existing = runsByZone.get(run.zoneId) ?? [];
      existing.push({ id: run.id, partnerId: run.partnerId });
      runsByZone.set(run.zoneId, existing);
    }

    const pickupLoad = new Map<string, number>(runs.map((run) => [run.id, 0]));

    const assignments: { pickupId: string; runId: string; partnerId: string }[] = [];
    const unassigned: PickupAssignmentResult['unassigned'] = [];
    let pickupOnlyRunsCreated = 0;

    /**
     * A zone with pickups but NO delivery run gets a pickup-only run.
     *
     * Pickups ride along with the delivery round because the partner is already on that
     * street — but "along with" cannot mean "only if". A customer who recycles without
     * subscribing to a newspaper, or a zone where nothing happens to be due today, would
     * otherwise have their pickup stranded every single day: they bundle up their paper,
     * nobody comes, and the only trace is a line in a log.
     *
     * So the run is created. It costs a trip that the delivery round would otherwise have
     * subsidised, which is worth knowing — but not collecting from a customer who asked is
     * not a saving, it is a broken promise.
     */
    const ensureRunForZone = async (
      zoneId: string,
    ): Promise<{ id: string; partnerId: string }[]> => {
      const existing = runsByZone.get(zoneId);
      if (existing !== undefined && existing.length > 0) return existing;

      const partner = eligiblePartners
        .filter((candidate) => candidate.zoneIds.includes(zoneId))
        .sort((a, b) => a.id.localeCompare(b.id))[0];

      // No eligible partner works this zone at all. Nothing to create a run for.
      if (partner === undefined) return [];

      const run = await this.delivery.createRunForPickups(date, partner.id, zoneId);
      pickupOnlyRunsCreated += 1;

      const created = [{ id: run.id, partnerId: run.partnerId }];
      runsByZone.set(zoneId, created);
      pickupLoad.set(run.id, 0);

      this.logger.log(
        `Zone ${zoneId} had pickups but no delivery run for ${date.toString()}; created a ` +
          `pickup-only run for partner ${partner.id}.`,
      );

      return created;
    };

    // Deterministic order, like the delivery planner: same inputs, same plan, so a
    // complaint can be reproduced.
    for (const pickup of [...pending].sort((a, b) => a.id.localeCompare(b.id))) {
      const zone = zones
        .filter((candidate) => candidate.isActive && candidate.pincodes.includes(pickup.pincode))
        .sort((a, b) => a.id.localeCompare(b.id))[0];

      if (zone === undefined) {
        // No active zone covers this pincode at all. Ops has to extend a zone; there is
        // nobody to create a run for. Reported, never silently dropped.
        unassigned.push({ pickupId: pickup.id, pincode: pickup.pincode, reason: 'NO_RUN_IN_ZONE' });
        continue;
      }

      // A zone with pickups but no delivery run gets a pickup-only run created here.
      const candidates = await ensureRunForZone(zone.id);

      if (candidates.length === 0) {
        // The zone exists but has no active, KYC-verified partner working it. Nobody to
        // create a run for. Still reported rather than dropped.
        unassigned.push({ pickupId: pickup.id, pincode: pickup.pincode, reason: 'NO_RUN_IN_ZONE' });
        continue;
      }

      const chosen = candidates.reduce((best, run) => {
        const bestLoad = pickupLoad.get(best.id) ?? 0;
        const load = pickupLoad.get(run.id) ?? 0;

        if (load !== bestLoad) return load < bestLoad ? run : best;
        return run.id < best.id ? run : best;
      });

      pickupLoad.set(chosen.id, (pickupLoad.get(chosen.id) ?? 0) + 1);
      assignments.push({ pickupId: pickup.id, runId: chosen.id, partnerId: chosen.partnerId });
    }

    const assigned = await this.pickups.assignToRun(assignments);

    this.logger.log(
      `Assigned ${assigned} pickup(s) to runs for ${date.toString()}` +
        (pickupOnlyRunsCreated > 0
          ? ` (${pickupOnlyRunsCreated} pickup-only run(s) created for zones with no delivery round)`
          : ''),
    );

    if (unassigned.length > 0) {
      this.logger.error(
        `${unassigned.length} pickup(s) for ${date.toString()} have no run to ride along with. ` +
          `These customers have bundled up their paper and nobody is coming. Pincodes: ` +
          `${[...new Set(unassigned.map((item) => item.pincode))].join(', ')}`,
      );
    }

    return { date, assigned, unassigned, pickupOnlyRunsCreated };
  }
}
