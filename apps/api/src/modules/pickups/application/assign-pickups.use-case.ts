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

    const [pending, zones, runs] = await Promise.all([
      this.pickups.listUnassignedForDate(date),
      this.delivery.loadPlannableZones(),
      this.delivery.listRunsForDate(date),
    ]);

    if (pending.length === 0) {
      return { date, assigned: 0, unassigned: [] };
    }

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

    // Deterministic order, like the delivery planner: same inputs, same plan, so a
    // complaint can be reproduced.
    for (const pickup of [...pending].sort((a, b) => a.id.localeCompare(b.id))) {
      const zone = zones
        .filter((candidate) => candidate.isActive && candidate.pincodes.includes(pickup.pincode))
        .sort((a, b) => a.id.localeCompare(b.id))[0];

      const candidates = zone === undefined ? undefined : runsByZone.get(zone.id);

      if (candidates === undefined || candidates.length === 0) {
        // No run covers this pincode today: either no zone has it, or the zone has no
        // available partner. Reported, never silently dropped — the customer has bundled
        // up their newspapers and is waiting at home.
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

    this.logger.log(`Assigned ${assigned} pickup(s) to runs for ${date.toString()}`);

    if (unassigned.length > 0) {
      this.logger.error(
        `${unassigned.length} pickup(s) for ${date.toString()} have no run to ride along with. ` +
          `These customers have bundled up their paper and nobody is coming. Pincodes: ` +
          `${[...new Set(unassigned.map((item) => item.pincode))].join(', ')}`,
      );
    }

    return { date, assigned, unassigned };
  }
}
