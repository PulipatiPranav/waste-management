import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { type PaperType } from '@/modules/wallet/domain/money';
import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import {
  type PickupRecord,
  type PickupRepository,
  type PlannablePickup,
  type RateCardRecord,
} from '../../domain/ports/pickup.repository';

const withItems = { items: true } satisfies Prisma.PickupRequestInclude;
type PickupRow = Prisma.PickupRequestGetPayload<{ include: typeof withItems }>;
type RateCardRow = Prisma.RateCardGetPayload<{ include: { items: true } }>;

@Injectable()
export class PrismaPickupRepository implements PickupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    userId: string;
    addressId: string;
    scheduledDate: Day;
    windowStartHour: number;
    windowEndHour: number;
    qrToken: string;
  }): Promise<PickupRecord> {
    const row = await this.prisma.pickupRequest.create({
      data: {
        userId: input.userId,
        addressId: input.addressId,
        scheduledDate: input.scheduledDate.toUtcDate(),
        windowStartHour: input.windowStartHour,
        windowEndHour: input.windowEndHour,
        qrToken: input.qrToken,
      },
      include: withItems,
    });

    return this.toDomain(row);
  }

  async findById(id: string): Promise<PickupRecord | null> {
    const row = await this.prisma.pickupRequest.findUnique({ where: { id }, include: withItems });
    return row === null ? null : this.toDomain(row);
  }

  async findByQrToken(token: string): Promise<PickupRecord | null> {
    const row = await this.prisma.pickupRequest.findUnique({
      where: { qrToken: token },
      include: withItems,
    });

    return row === null ? null : this.toDomain(row);
  }

  async listForUser(userId: string): Promise<PickupRecord[]> {
    const rows = await this.prisma.pickupRequest.findMany({
      where: { userId },
      include: withItems,
      orderBy: { scheduledDate: 'desc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  async listForRun(runId: string): Promise<PickupRecord[]> {
    const rows = await this.prisma.pickupRequest.findMany({
      where: { runId },
      include: withItems,
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  async listUnassignedForDate(date: Day): Promise<PlannablePickup[]> {
    const rows = await this.prisma.pickupRequest.findMany({
      where: { scheduledDate: date.toUtcDate(), status: 'REQUESTED' },
      include: { address: { select: { pincode: true } } },
    });

    return rows.map((row) => ({ id: row.id, pincode: row.address.pincode }));
  }

  /**
   * Attach pickups to runs, conditionally.
   *
   * `updateMany ... WHERE status = 'REQUESTED'` so a re-run of the nightly planner cannot
   * re-assign (or un-assign) a pickup a partner is already standing in front of. Returns
   * how many were actually claimed.
   */
  async assignToRun(
    assignments: readonly { pickupId: string; runId: string; partnerId: string }[],
  ): Promise<number> {
    if (assignments.length === 0) return 0;

    const results = await this.prisma.$transaction(
      assignments.map((assignment) =>
        this.prisma.pickupRequest.updateMany({
          where: { id: assignment.pickupId, status: 'REQUESTED' },
          data: {
            status: 'ASSIGNED',
            runId: assignment.runId,
            assignedPartnerId: assignment.partnerId,
          },
        }),
      ),
    );

    return results.reduce((sum, result) => sum + result.count, 0);
  }

  async cancel(id: string): Promise<PickupRecord> {
    const row = await this.prisma.pickupRequest.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: withItems,
    });

    return this.toDomain(row);
  }

  // --- Rate cards -----------------------------------------------------------

  async activeRateCard(): Promise<RateCardRecord | null> {
    const row = await this.prisma.rateCard.findFirst({
      where: { isActive: true },
      include: { items: true },
    });

    return row === null ? null : this.toRateCard(row);
  }

  async listRateCards(): Promise<RateCardRecord[]> {
    const rows = await this.prisma.rateCard.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toRateCard(row));
  }

  /**
   * One transaction: retire the current active card, then create (and maybe activate) the
   * new one.
   *
   * A partial unique index enforces at most one active card, so doing this in two steps
   * would leave a window where the insert is rejected — or, worse, a moment with two
   * active cards during which a pickup could be priced from either.
   */
  async createRateCard(input: {
    name: string;
    rates: { paperType: PaperType; ratePerKgPaise: number }[];
    activate: boolean;
  }): Promise<RateCardRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      if (input.activate) {
        await tx.rateCard.updateMany({
          where: { isActive: true },
          data: { isActive: false, retiredAt: new Date() },
        });
      }

      return tx.rateCard.create({
        data: {
          name: input.name,
          isActive: input.activate,
          items: {
            create: input.rates.map((rate) => ({
              paperType: rate.paperType,
              ratePerKgPaise: rate.ratePerKgPaise,
            })),
          },
        },
        include: { items: true },
      });
    });

    return this.toRateCard(row);
  }

  async activateRateCard(id: string): Promise<RateCardRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const target = await tx.rateCard.findUnique({ where: { id } });

      if (target === null) {
        throw new NotFoundError('Rate card not found');
      }

      await tx.rateCard.updateMany({
        where: { isActive: true },
        data: { isActive: false, retiredAt: new Date() },
      });

      return tx.rateCard.update({
        where: { id },
        data: { isActive: true, retiredAt: null },
        include: { items: true },
      });
    });

    return this.toRateCard(row);
  }

  // --- Mapping --------------------------------------------------------------

  private toDomain(row: PickupRow): PickupRecord {
    return {
      id: row.id,
      userId: row.userId,
      addressId: row.addressId,
      scheduledDate: Day.fromUtcDate(row.scheduledDate),
      windowStartHour: row.windowStartHour,
      windowEndHour: row.windowEndHour,
      status: row.status,
      qrToken: row.qrToken,
      runId: row.runId,
      assignedPartnerId: row.assignedPartnerId,
      items: row.items.map((item) => ({
        paperType: item.paperType,
        weightGrams: item.weightGrams,
        ratePerKgPaiseAtPickup: item.ratePerKgPaiseAtPickup,
        amountPaise: item.amountPaise,
      })),
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    };
  }

  private toRateCard(row: RateCardRow): RateCardRecord {
    return {
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      rates: row.items.map((item) => ({
        paperType: item.paperType,
        ratePerKgPaise: item.ratePerKgPaise,
      })),
    };
  }
}
