import { Injectable } from '@nestjs/common';
import { type Prisma, type VehicleType } from '@prisma/client';

import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import {
  type CompletionStats,
  type DeliveryPartnerRecord,
  type DeliveryRepository,
  type RunRecord,
  type StopRecord,
} from '../../domain/ports/delivery.repository';
import {
  type PlannablePartner,
  type PlannableSubscription,
  type PlannableZone,
  type PlannedRun,
} from '../../domain/services/run-planner';
import { type StopOutcome, type StopStatus } from '../../domain/stop-status';

const partnerInclude = {
  user: { select: { name: true, phone: true } },
  zones: { select: { zoneId: true } },
} satisfies Prisma.DeliveryPartnerInclude;

type PartnerRow = Prisma.DeliveryPartnerGetPayload<{ include: typeof partnerInclude }>;
type RunRow = Prisma.DailyDeliveryRunGetPayload<{ include: { stops: true } }>;

@Injectable()
export class PrismaDeliveryRepository implements DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Planner inputs -------------------------------------------------------

  async loadPlannableSubscriptions(runDate: Day): Promise<PlannableSubscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: {
        // Narrowed here for volume, not for correctness: the planner re-checks every
        // rule (frequency, pauses, cancellation) in pure code, where it is tested.
        status: 'ACTIVE',
        startDate: { lte: runDate.toUtcDate() },
      },
      include: {
        deliveryAddress: { select: { pincode: true } },
        pauses: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      addressId: row.deliveryAddressId,
      pincode: row.deliveryAddress.pincode,
      frequency: row.frequency,
      status: 'ACTIVE' as const,
      startDate: Day.fromUtcDate(row.startDate),
      cancelledOn: row.cancelledAt === null ? null : Day.fromUtcDate(row.cancelledAt),
      pauses: row.pauses.map((pause) => ({
        pausedFrom: Day.fromUtcDate(pause.pausedFrom),
        resumedFrom: pause.resumedFrom === null ? null : Day.fromUtcDate(pause.resumedFrom),
      })),
    }));
  }

  async loadPlannableZones(): Promise<PlannableZone[]> {
    const rows = await this.prisma.deliveryZone.findMany();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      pincodes: row.pincodes,
      isActive: row.isActive,
    }));
  }

  async loadPlannablePartners(): Promise<PlannablePartner[]> {
    const rows = await this.prisma.deliveryPartner.findMany({
      include: { zones: { select: { zoneId: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      zoneIds: row.zones.map((zone) => zone.zoneId),
      isActive: row.isActive,
      isAvailable: row.isAvailable,
      kycStatus: row.kycStatus,
    }));
  }

  /**
   * Writes the plan, one transaction per run.
   *
   * Per run rather than one giant transaction: a single transaction over thousands of
   * stops holds locks for the whole write and rolls the entire night back if one zone
   * has a problem. Per-run means a bad zone loses one run sheet, not all of them — and
   * the unique index makes a re-run of the job pick up exactly what is missing.
   */
  async persistPlan(
    runDate: Day,
    runs: readonly PlannedRun[],
  ): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const run of runs) {
      const existing = await this.prisma.dailyDeliveryRun.findUnique({
        where: {
          runDate_partnerId_zoneId: {
            runDate: runDate.toUtcDate(),
            partnerId: run.partnerId,
            zoneId: run.zoneId,
          },
        },
      });

      // Already planned — a retry, a manual kick, or two workers racing. Leave it
      // alone: the partner may already be halfway through this sheet.
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      try {
        await this.prisma.dailyDeliveryRun.create({
          data: {
            runDate: runDate.toUtcDate(),
            partnerId: run.partnerId,
            zoneId: run.zoneId,
            stops: {
              create: run.stops.map((stop) => ({
                subscriptionId: stop.subscriptionId,
                addressId: stop.addressId,
                sequence: stop.sequence,
              })),
            },
          },
        });
        created += 1;
      } catch (error) {
        // P2002 = unique violation: another worker created this run between our check
        // and our insert. That is the index doing its job, not an error.
        if (isUniqueViolation(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }

  // --- Partner --------------------------------------------------------------

  async findPartnerByUserId(userId: string): Promise<DeliveryPartnerRecord | null> {
    const row = await this.prisma.deliveryPartner.findUnique({
      where: { userId },
      include: partnerInclude,
    });

    return row === null ? null : this.toPartner(row);
  }

  async findPartnerById(id: string): Promise<DeliveryPartnerRecord | null> {
    const row = await this.prisma.deliveryPartner.findUnique({
      where: { id },
      include: partnerInclude,
    });

    return row === null ? null : this.toPartner(row);
  }

  async listRunsForPartner(partnerId: string, runDate: Day): Promise<RunRecord[]> {
    const rows = await this.prisma.dailyDeliveryRun.findMany({
      where: { partnerId, runDate: runDate.toUtcDate() },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    return rows.map((row) => this.toRun(row));
  }

  async findStopById(id: string): Promise<(StopRecord & { partnerId: string }) | null> {
    const row = await this.prisma.deliveryStop.findUnique({
      where: { id },
      include: { run: { select: { partnerId: true } } },
    });

    if (row === null) return null;

    return { ...this.toStop(row), partnerId: row.run.partnerId };
  }

  /**
   * Conditional update: record the outcome only while the stop is still PENDING.
   *
   * `updateMany` with `status: 'PENDING'` in the WHERE compiles to a single
   * `UPDATE ... WHERE id = $1 AND status = 'PENDING'`, and Postgres serialises
   * concurrent writers to the row. A partner double-submitting on a flaky network gets
   * one write and one "already recorded" — rather than the second request silently
   * overwriting the first one's reason, photo and timestamp.
   */
  async recordOutcome(input: {
    stopId: string;
    outcome: StopOutcome;
    reason: string | null;
    photoKey: string | null;
    at: Date;
  }): Promise<StopRecord | null> {
    const result = await this.prisma.deliveryStop.updateMany({
      where: { id: input.stopId, status: 'PENDING' },
      data: {
        status: input.outcome,
        reason: input.reason,
        completedAt: input.at,
        ...(input.photoKey !== null ? { photoKey: input.photoKey } : {}),
      },
    });

    if (result.count === 0) return null;

    const row = await this.prisma.deliveryStop.findUniqueOrThrow({ where: { id: input.stopId } });
    return this.toStop(row);
  }

  async attachPhoto(stopId: string, photoKey: string): Promise<void> {
    await this.prisma.deliveryStop.update({
      where: { id: stopId },
      data: { photoKey },
    });
  }

  async refreshRunStatus(
    runId: string,
    at: Date,
  ): Promise<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'> {
    const stops = await this.prisma.deliveryStop.findMany({
      where: { runId },
      select: { status: true },
    });

    const actioned = stops.filter((stop) => stop.status !== 'PENDING').length;

    const status =
      actioned === 0 ? 'PENDING' : actioned === stops.length ? 'COMPLETED' : 'IN_PROGRESS';

    await this.prisma.dailyDeliveryRun.update({
      where: { id: runId },
      data: {
        status,
        ...(status === 'IN_PROGRESS' ? { startedAt: at } : {}),
        ...(status === 'COMPLETED' ? { completedAt: at } : {}),
      },
    });

    return status;
  }

  // --- Admin ----------------------------------------------------------------

  async onboardPartner(input: {
    userId: string;
    vehicleType: string;
    zoneIds: string[];
  }): Promise<DeliveryPartnerRecord> {
    const row = await this.prisma.deliveryPartner.create({
      data: {
        userId: input.userId,
        vehicleType: input.vehicleType as VehicleType,
        zones: { create: input.zoneIds.map((zoneId) => ({ zoneId })) },
      },
      include: partnerInclude,
    });

    return this.toPartner(row);
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
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.zoneIds !== undefined) {
        // Replace the set wholesale. A diff would be fiddlier and no more correct.
        await tx.deliveryPartnerZone.deleteMany({ where: { partnerId: id } });
        await tx.deliveryPartnerZone.createMany({
          data: input.zoneIds.map((zoneId) => ({ partnerId: id, zoneId })),
        });
      }

      return tx.deliveryPartner.update({
        where: { id },
        data: {
          ...(input.kycStatus !== undefined ? { kycStatus: input.kycStatus } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
          ...(input.vehicleType !== undefined
            ? { vehicleType: input.vehicleType as VehicleType }
            : {}),
        },
        include: partnerInclude,
      });
    });

    return this.toPartner(row);
  }

  async listPartners(): Promise<DeliveryPartnerRecord[]> {
    const rows = await this.prisma.deliveryPartner.findMany({
      include: partnerInclude,
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => this.toPartner(row));
  }

  async findRunById(id: string): Promise<RunRecord | null> {
    const row = await this.prisma.dailyDeliveryRun.findUnique({
      where: { id },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    return row === null ? null : this.toRun(row);
  }

  /**
   * Hand a whole run to a different partner.
   *
   * Refused once ANY stop has been actioned. Moving a half-done run would either
   * discard the first partner's completed deliveries or hand the second partner a sheet
   * whose completed stops they never made — and in Phase 4 those stops decide whether a
   * customer is billed. If ops needs to move the remainder, that is a different
   * operation (split the run), and it needs to be designed rather than fallen into.
   */
  async reassignRun(runId: string, toPartnerId: string): Promise<RunRecord> {
    const run = await this.prisma.dailyDeliveryRun.findUnique({
      where: { id: runId },
      include: { stops: true },
    });

    if (run === null) {
      throw new NotFoundError('Delivery run not found');
    }

    if (run.stops.some((stop) => stop.status !== 'PENDING')) {
      throw new ConflictError(
        'This run has already been started and cannot be reassigned. Deliveries already recorded would be attributed to the wrong partner.',
      );
    }

    if (run.partnerId === toPartnerId) {
      throw new ConflictError('The run is already assigned to that partner.');
    }

    const updated = await this.prisma.dailyDeliveryRun.update({
      where: { id: runId },
      data: { partnerId: toPartnerId },
      include: { stops: { orderBy: { sequence: 'asc' } } },
    });

    return this.toRun(updated);
  }

  async completionStats(runDate: Day): Promise<CompletionStats[]> {
    const runs = await this.prisma.dailyDeliveryRun.findMany({
      where: { runDate: runDate.toUtcDate() },
      include: {
        stops: { select: { status: true } },
        zone: { select: { name: true } },
        partner: { include: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return runs.map((run) => {
      const count = (status: StopStatus) =>
        run.stops.filter((stop) => stop.status === status).length;

      const total = run.stops.length;
      const delivered = count('DELIVERED');

      return {
        runDate,
        zoneId: run.zoneId,
        zoneName: run.zone.name,
        partnerId: run.partnerId,
        partnerName: run.partner.user.name,
        total,
        delivered,
        failed: count('FAILED'),
        skipped: count('SKIPPED'),
        pending: count('PENDING'),
        // Null, not 0, for an empty run. A "0% completion" that really means "there was
        // nothing to deliver" is the kind of metric that gets someone shouted at.
        completionRate: total === 0 ? null : delivered / total,
      };
    });
  }

  async createZone(input: {
    name: string;
    city: string;
    pincodes: string[];
  }): Promise<PlannableZone> {
    const row = await this.prisma.deliveryZone.create({ data: input });

    return { id: row.id, name: row.name, pincodes: row.pincodes, isActive: row.isActive };
  }

  async listZones(): Promise<PlannableZone[]> {
    return this.loadPlannableZones();
  }

  // --- Mapping --------------------------------------------------------------

  private toPartner(row: PartnerRow): DeliveryPartnerRecord {
    return {
      id: row.id,
      userId: row.userId,
      name: row.user.name,
      phone: row.user.phone,
      kycStatus: row.kycStatus,
      vehicleType: row.vehicleType,
      isActive: row.isActive,
      isAvailable: row.isAvailable,
      zoneIds: row.zones.map((zone) => zone.zoneId),
    };
  }

  private toRun(row: RunRow): RunRecord {
    return {
      id: row.id,
      runDate: Day.fromUtcDate(row.runDate),
      partnerId: row.partnerId,
      zoneId: row.zoneId,
      status: row.status,
      stops: row.stops.map((stop) => this.toStop(stop)),
    };
  }

  private toStop(row: {
    id: string;
    runId: string;
    subscriptionId: string;
    addressId: string;
    status: StopStatus;
    reason: string | null;
    photoKey: string | null;
    sequence: number;
    completedAt: Date | null;
  }): StopRecord {
    return {
      id: row.id,
      runId: row.runId,
      subscriptionId: row.subscriptionId,
      addressId: row.addressId,
      status: row.status,
      reason: row.reason,
      photoKey: row.photoKey,
      sequence: row.sequence,
      completedAt: row.completedAt,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
