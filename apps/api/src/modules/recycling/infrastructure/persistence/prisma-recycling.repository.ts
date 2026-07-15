import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { type PaperType } from '@/modules/wallet/domain/money';
import { ConflictError } from '@/shared/domain/errors/domain.error';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type BatchStatus } from '../../domain/batch-state-machine';
import { type BatchableItem, type BatchGroup } from '../../domain/batching';
import {
  type BatchRecord,
  type ChainOfCustody,
  type DispatchRecord,
  type PartnerStatus,
  type RecyclingPartnerRecord,
  type RecyclingRepository,
} from '../../domain/ports/recycling.repository';

type PartnerRow = Prisma.RecyclingPartnerGetPayload<object>;
type BatchRow = Prisma.CollectionBatchGetPayload<{ include: { zone: { select: { name: true } } } }>;
type DispatchRow = Prisma.BatchDispatchGetPayload<{
  include: { partner: { select: { name: true } } };
}>;

const withZone = { zone: { select: { name: true } } } satisfies Prisma.CollectionBatchInclude;
const withPartnerName = {
  partner: { select: { name: true } },
} satisfies Prisma.BatchDispatchInclude;

@Injectable()
export class PrismaRecyclingRepository implements RecyclingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- Partners -------------------------------------------------------------

  async createPartner(
    input: Omit<RecyclingPartnerRecord, 'id' | 'status'>,
  ): Promise<RecyclingPartnerRecord> {
    const row = await this.prisma.recyclingPartner.create({
      data: {
        name: input.name,
        acceptedPaperTypes: input.acceptedPaperTypes,
        dailyCapacityGrams: input.dailyCapacityGrams,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        addressLine: input.addressLine,
        gstin: input.gstin,
        pollutionBoardId: input.pollutionBoardId,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
      },
    });

    return this.toPartner(row);
  }

  async listPartners(status?: PartnerStatus): Promise<RecyclingPartnerRecord[]> {
    const rows = await this.prisma.recyclingPartner.findMany({
      where: status === undefined ? {} : { status },
      orderBy: { name: 'asc' },
    });

    return rows.map((row) => this.toPartner(row));
  }

  async findPartnerById(id: string): Promise<RecyclingPartnerRecord | null> {
    const row = await this.prisma.recyclingPartner.findUnique({ where: { id } });
    return row === null ? null : this.toPartner(row);
  }

  async updatePartner(
    id: string,
    input: Partial<Omit<RecyclingPartnerRecord, 'id'>> & { verifiedByUserId?: string },
  ): Promise<RecyclingPartnerRecord> {
    const row = await this.prisma.recyclingPartner.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.acceptedPaperTypes !== undefined
          ? { acceptedPaperTypes: input.acceptedPaperTypes }
          : {}),
        ...(input.dailyCapacityGrams !== undefined
          ? { dailyCapacityGrams: input.dailyCapacityGrams }
          : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        // Verification is a real event with a real person behind it. An ESG auditor asks who
        // vetted the mill; "the system" is not an answer.
        ...(input.status === 'VERIFIED'
          ? { verifiedAt: new Date(), verifiedByUserId: input.verifiedByUserId ?? null }
          : {}),
      },
    });

    return this.toPartner(row);
  }

  async dispatchedToPartnerOnDateGrams(partnerId: string, date: Date): Promise<number> {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const dispatches = await this.prisma.batchDispatch.findMany({
      where: {
        partnerId,
        dispatchedAt: { gte: start, lt: end },
        // A rejected load was turned away at the gate; it never occupied the mill's capacity.
        status: { in: ['IN_TRANSIT', 'CONFIRMED'] },
      },
      include: { batch: { select: { collectedWeightGrams: true } } },
    });

    return dispatches.reduce((sum, dispatch) => sum + dispatch.batch.collectedWeightGrams, 0);
  }

  // --- Batching -------------------------------------------------------------

  async listUnbatchedItems(): Promise<BatchableItem[]> {
    const rows = await this.prisma.pickupItem.findMany({
      where: {
        // The whole query. An explicit column, not a reconstruction from dates and zones —
        // which is what makes the batching job idempotent and the chain of custody a fact.
        batchId: null,
        pickup: { status: 'COMPLETED' },
      },
      include: {
        pickup: {
          include: { address: { select: { pincode: true } } },
        },
      },
    });

    // A pickup's zone is resolved from its address pincode, the same way the delivery planner
    // does it. Loaded here rather than joined in SQL because zones are few and cached, and
    // the grouping itself is a pure function that must not be able to query.
    const zones = await this.prisma.deliveryZone.findMany({
      where: { isActive: true },
      select: { id: true, pincodes: true },
      orderBy: { id: 'asc' },
    });

    const items: BatchableItem[] = [];

    for (const row of rows) {
      const zone = zones.find((candidate) =>
        candidate.pincodes.includes(row.pickup.address.pincode),
      );

      // A pickup whose pincode no longer maps to an active zone. It was collected — the
      // customer was paid — so the paper physically exists in a warehouse somewhere. It
      // simply cannot be batched until ops restores a zone covering it. Skipped rather than
      // guessed at: putting it in an arbitrary zone would corrupt the chain of custody.
      if (zone === undefined) continue;

      items.push({
        id: row.id,
        zoneId: zone.id,
        paperType: row.paperType,
        weightGrams: row.weightGrams,
      });
    }

    return items;
  }

  /**
   * One transaction: find-or-create the OPEN batch, claim the items, recompute the weight.
   *
   * Claiming is a conditional update (`batchId: null`), so two batching runs racing cannot
   * put the same item into two batches. An item counted twice is tonnage claimed twice — the
   * fastest possible way to lose an ESG audit.
   */
  async applyBatchGroup(group: BatchGroup): Promise<BatchRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      let batch = await tx.collectionBatch.findFirst({
        where: { zoneId: group.zoneId, paperType: group.paperType, status: 'OPEN' },
      });

      batch ??= await tx.collectionBatch.create({
        data: {
          reference: `BATCH-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex').toUpperCase()}`,
          zoneId: group.zoneId,
          paperType: group.paperType,
        },
      });

      const claimed = await tx.pickupItem.updateMany({
        where: { id: { in: group.itemIds }, batchId: null },
        data: { batchId: batch.id },
      });

      if (claimed.count > 0) {
        // Recomputed from the items, in the same transaction — the cached weight is never
        // adjusted by hand. Same relationship the wallet balance has to its ledger.
        const totals = await tx.pickupItem.aggregate({
          where: { batchId: batch.id },
          _sum: { weightGrams: true },
          _count: true,
        });

        await tx.collectionBatch.update({
          where: { id: batch.id },
          data: {
            collectedWeightGrams: totals._sum.weightGrams ?? 0,
            itemCount: totals._count,
          },
        });
      }

      return tx.collectionBatch.findUniqueOrThrow({
        where: { id: batch.id },
        include: withZone,
      });
    });

    return this.toBatch(row);
  }

  async listBatches(status?: BatchStatus): Promise<BatchRecord[]> {
    const rows = await this.prisma.collectionBatch.findMany({
      where: status === undefined ? {} : { status },
      include: withZone,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toBatch(row));
  }

  async findBatchById(id: string): Promise<BatchRecord | null> {
    const row = await this.prisma.collectionBatch.findUnique({ where: { id }, include: withZone });
    return row === null ? null : this.toBatch(row);
  }

  async closeBatch(id: string): Promise<BatchRecord> {
    // Conditional on OPEN: two ops staff clicking "close" at once must not both succeed, and
    // a batch already on a truck must not be re-closed.
    const claimed = await this.prisma.collectionBatch.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'READY', closedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new ConflictError('This batch is not open, so it cannot be closed.');
    }

    const row = await this.prisma.collectionBatch.findUniqueOrThrow({
      where: { id },
      include: withZone,
    });

    return this.toBatch(row);
  }

  // --- Dispatch -------------------------------------------------------------

  async dispatch(input: {
    batchId: string;
    partnerId: string;
    transporterName: string;
    transporterVehicleNo: string;
    transporterContact: string;
  }): Promise<DispatchRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      // READY -> DISPATCHED, conditionally. The unique index on BatchDispatch.batchId is the
      // second lock on the same door: a batch cannot be sent twice.
      const claimed = await tx.collectionBatch.updateMany({
        where: { id: input.batchId, status: 'READY' },
        data: { status: 'DISPATCHED' },
      });

      if (claimed.count === 0) {
        throw new ConflictError(
          'This batch is not READY. Close it first, and check it has not already been dispatched.',
        );
      }

      return tx.batchDispatch.create({
        data: {
          batchId: input.batchId,
          partnerId: input.partnerId,
          transporterName: input.transporterName,
          transporterVehicleNo: input.transporterVehicleNo,
          transporterContact: input.transporterContact,
        },
        include: withPartnerName,
      });
    });

    return this.toDispatch(row);
  }

  async confirmDispatch(input: {
    dispatchId: string;
    confirmedWeightGrams: number;
    discrepancyGrams: number;
    discrepancyBps: number;
    discrepancyFlagged: boolean;
    weighbridgeSlipRef: string | null;
    confirmedByUserId: string;
  }): Promise<DispatchRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.batchDispatch.updateMany({
        where: { id: input.dispatchId, status: 'IN_TRANSIT' },
        data: {
          status: 'CONFIRMED',
          // Recorded ALONGSIDE the batch's collected weight, never over it. Both numbers are
          // real measurements; the gap between them is the finding.
          confirmedWeightGrams: input.confirmedWeightGrams,
          discrepancyGrams: input.discrepancyGrams,
          discrepancyBps: input.discrepancyBps,
          discrepancyFlagged: input.discrepancyFlagged,
          weighbridgeSlipRef: input.weighbridgeSlipRef,
          confirmedAt: new Date(),
          confirmedByUserId: input.confirmedByUserId,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictError('This dispatch is not in transit, so it cannot be confirmed.');
      }

      const dispatch = await tx.batchDispatch.findUniqueOrThrow({
        where: { id: input.dispatchId },
        include: withPartnerName,
      });

      await tx.collectionBatch.update({
        where: { id: dispatch.batchId },
        data: { status: 'CONFIRMED' },
      });

      return dispatch;
    });

    return this.toDispatch(row);
  }

  async rejectDispatch(input: {
    dispatchId: string;
    reason: string;
    confirmedByUserId: string;
  }): Promise<DispatchRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.batchDispatch.updateMany({
        where: { id: input.dispatchId, status: 'IN_TRANSIT' },
        data: {
          status: 'REJECTED',
          rejectionReason: input.reason,
          confirmedByUserId: input.confirmedByUserId,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictError('This dispatch is not in transit.');
      }

      const dispatch = await tx.batchDispatch.findUniqueOrThrow({
        where: { id: input.dispatchId },
        include: withPartnerName,
      });

      // The load came back. The batch returns to READY so it can be sent to a DIFFERENT mill
      // — the paper still exists and still has to go somewhere. It does NOT go back to OPEN:
      // its collected weight is already fixed and the items are already attributed.
      await tx.collectionBatch.update({
        where: { id: dispatch.batchId },
        data: { status: 'READY' },
      });

      return dispatch;
    });

    return this.toDispatch(row);
  }

  async findDispatchById(id: string): Promise<DispatchRecord | null> {
    const row = await this.prisma.batchDispatch.findUnique({
      where: { id },
      include: withPartnerName,
    });

    return row === null ? null : this.toDispatch(row);
  }

  async listFlaggedDispatches(): Promise<DispatchRecord[]> {
    const rows = await this.prisma.batchDispatch.findMany({
      where: { discrepancyFlagged: true },
      include: withPartnerName,
      orderBy: { confirmedAt: 'desc' },
    });

    return rows.map((row) => this.toDispatch(row));
  }

  // --- Traceability ---------------------------------------------------------

  /**
   * The whole chain, in one read.
   *
   * This is what an ESG auditor is really asking for behind "substantiate that tonnage":
   * every gram attributed to the customer who handed it over, the partner who collected it,
   * the truck it rode on, and the mill that weighed it at the far end.
   */
  async chainOfCustody(batchId: string): Promise<ChainOfCustody | null> {
    const batch = await this.prisma.collectionBatch.findUnique({
      where: { id: batchId },
      include: {
        zone: { select: { name: true } },
        dispatch: { include: { partner: true } },
        items: {
          include: {
            pickup: {
              select: {
                id: true,
                userId: true,
                completedAt: true,
                assignedPartnerId: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (batch === null) return null;

    const items = batch.items.map((item) => ({
      pickupItemId: item.id,
      pickupId: item.pickupId,
      customerId: item.pickup.userId,
      paperType: item.paperType,
      weightGrams: item.weightGrams,
      collectedAt: item.pickup.completedAt,
      collectedByPartnerId: item.pickup.assignedPartnerId,
    }));

    return {
      batch: this.toBatch(batch),
      dispatch: batch.dispatch === null ? null : this.toDispatch(batch.dispatch),
      partner: batch.dispatch === null ? null : this.toPartner(batch.dispatch.partner),
      items,
      totalItemWeightGrams: items.reduce((sum, item) => sum + item.weightGrams, 0),
    };
  }

  async traceCustomerPaper(userId: string): Promise<
    {
      pickupItemId: string;
      pickupId: string;
      paperType: PaperType;
      weightGrams: number;
      batchReference: string | null;
      batchStatus: BatchStatus | null;
      partnerName: string | null;
      confirmedAt: Date | null;
    }[]
  > {
    const items = await this.prisma.pickupItem.findMany({
      where: { pickup: { userId, status: 'COMPLETED' } },
      include: {
        batch: { include: { dispatch: { include: { partner: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => ({
      pickupItemId: item.id,
      pickupId: item.pickupId,
      paperType: item.paperType,
      weightGrams: item.weightGrams,
      batchReference: item.batch?.reference ?? null,
      batchStatus: item.batch?.status ?? null,
      partnerName: item.batch?.dispatch?.partner.name ?? null,
      confirmedAt: item.batch?.dispatch?.confirmedAt ?? null,
    }));
  }

  // --- Mapping --------------------------------------------------------------

  private toPartner(row: PartnerRow): RecyclingPartnerRecord {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      acceptedPaperTypes: row.acceptedPaperTypes,
      dailyCapacityGrams: row.dailyCapacityGrams,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      addressLine: row.addressLine,
      gstin: row.gstin,
      pollutionBoardId: row.pollutionBoardId,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
    };
  }

  private toBatch(row: BatchRow): BatchRecord {
    return {
      id: row.id,
      reference: row.reference,
      zoneId: row.zoneId,
      zoneName: row.zone.name,
      paperType: row.paperType,
      status: row.status,
      collectedWeightGrams: row.collectedWeightGrams,
      itemCount: row.itemCount,
      closedAt: row.closedAt,
      createdAt: row.createdAt,
    };
  }

  private toDispatch(row: DispatchRow): DispatchRecord {
    return {
      id: row.id,
      batchId: row.batchId,
      partnerId: row.partnerId,
      partnerName: row.partner.name,
      status: row.status,
      dispatchedAt: row.dispatchedAt,
      transporterName: row.transporterName,
      transporterVehicleNo: row.transporterVehicleNo,
      transporterContact: row.transporterContact,
      confirmedWeightGrams: row.confirmedWeightGrams,
      discrepancyGrams: row.discrepancyGrams,
      discrepancyBps: row.discrepancyBps,
      discrepancyFlagged: row.discrepancyFlagged,
      confirmedAt: row.confirmedAt,
      rejectionReason: row.rejectionReason,
      weighbridgeSlipRef: row.weighbridgeSlipRef,
    };
  }
}
