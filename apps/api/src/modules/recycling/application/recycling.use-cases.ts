import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { type PaperType } from '@/modules/wallet/domain/money';
import {
  ConflictError,
  InvariantViolationError,
  NotFoundError,
} from '@/shared/domain/errors/domain.error';
import { applyBatchTransition } from '../domain/batch-state-machine';
import { canDispatchTo, groupIntoBatches } from '../domain/batching';
import { calculateDiscrepancy } from '../domain/discrepancy';
import {
  RECYCLING_REPOSITORY,
  type BatchRecord,
  type ChainOfCustody,
  type DispatchRecord,
  type PartnerStatus,
  type RecyclingPartnerRecord,
  type RecyclingRepository,
} from '../domain/ports/recycling.repository';

export interface BatchingResult {
  groupsProcessed: number;
  itemsBatched: number;
  batchesReadyToDispatch: number;
  batches: BatchRecord[];
}

@Injectable()
export class RecyclingUseCases {
  private readonly logger = new Logger(RecyclingUseCases.name);

  constructor(
    @Inject(RECYCLING_REPOSITORY) private readonly recycling: RecyclingRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // --- Batching -------------------------------------------------------------

  /**
   * Sweeps completed pickups into collection batches.
   *
   * Idempotent: it only ever looks at items with no batch, and claiming them is a
   * conditional update. Running it twice batches nothing the second time.
   */
  async runBatching(): Promise<BatchingResult> {
    const minimum = this.config.get('BATCH_MIN_WEIGHT_GRAMS', { infer: true });

    const items = await this.recycling.listUnbatchedItems();

    if (items.length === 0) {
      return { groupsProcessed: 0, itemsBatched: 0, batchesReadyToDispatch: 0, batches: [] };
    }

    const groups = groupIntoBatches(items, minimum);
    const batches: BatchRecord[] = [];

    for (const group of groups) {
      batches.push(await this.recycling.applyBatchGroup(group));
    }

    const ready = groups.filter((group) => group.readyToDispatch).length;

    this.logger.log(
      `Batched ${items.length} item(s) into ${groups.length} batch(es); ` +
        `${ready} at or above the ${minimum} g dispatch minimum.`,
    );

    return {
      groupsProcessed: groups.length,
      itemsBatched: items.length,
      batchesReadyToDispatch: ready,
      batches,
    };
  }

  listBatches(status?: BatchRecord['status']): Promise<BatchRecord[]> {
    return this.recycling.listBatches(status);
  }

  async closeBatch(id: string): Promise<BatchRecord> {
    const batch = await this.requireBatch(id);

    // The state machine answers the legality question; the repository's conditional UPDATE
    // makes it safe under concurrency. Both, deliberately.
    applyBatchTransition(batch.status, 'CLOSE');

    if (batch.itemCount === 0) {
      throw new InvariantViolationError(
        'This batch is empty. Closing it would send an empty truck to a mill.',
      );
    }

    return this.recycling.closeBatch(id);
  }

  // --- Partners -------------------------------------------------------------

  onboardPartner(
    input: Omit<RecyclingPartnerRecord, 'id' | 'status'>,
  ): Promise<RecyclingPartnerRecord> {
    // Starts PENDING. A mill is never verified by the act of being typed into a form.
    return this.recycling.createPartner(input);
  }

  listPartners(status?: PartnerStatus): Promise<RecyclingPartnerRecord[]> {
    return this.recycling.listPartners(status);
  }

  async updatePartner(
    id: string,
    input: Partial<Omit<RecyclingPartnerRecord, 'id'>>,
    actorUserId: string,
  ): Promise<RecyclingPartnerRecord> {
    await this.requirePartner(id);

    if (input.status === 'VERIFIED') {
      this.logger.log(`Recycling partner ${id} VERIFIED by ${actorUserId}`);
    }

    return this.recycling.updatePartner(id, { ...input, verifiedByUserId: actorUserId });
  }

  // --- Dispatch -------------------------------------------------------------

  async dispatchBatch(input: {
    batchId: string;
    partnerId: string;
    transporterName: string;
    transporterVehicleNo: string;
    transporterContact: string;
  }): Promise<{ dispatch: DispatchRecord; warning: string | null }> {
    const batch = await this.requireBatch(input.batchId);
    const partner = await this.requirePartner(input.partnerId);

    applyBatchTransition(batch.status, 'DISPATCH');

    const alreadyToday = await this.recycling.dispatchedToPartnerOnDateGrams(
      partner.id,
      new Date(),
    );

    // Checked BEFORE the truck is loaded. The failure mode otherwise is a lorry arriving at a
    // gate and being turned away: a day, a driver, and the relationship.
    const eligibility = canDispatchTo(
      {
        status: partner.status,
        acceptedPaperTypes: partner.acceptedPaperTypes,
        dailyCapacityGrams: partner.dailyCapacityGrams,
      },
      { paperType: batch.paperType, collectedWeightGrams: batch.collectedWeightGrams },
      alreadyToday,
    );

    if (!eligibility.eligible) {
      throw new ConflictError(eligibility.reason ?? 'This partner cannot take this batch.');
    }

    const dispatch = await this.recycling.dispatch(input);

    this.logger.log(
      `Batch ${batch.reference} (${batch.collectedWeightGrams} g of ${batch.paperType}) ` +
        `dispatched to ${partner.name} on ${input.transporterVehicleNo}`,
    );

    // Capacity is advisory, so an eligible dispatch can still carry a warning. Surfaced to
    // the human, who can phone the mill.
    return { dispatch, warning: eligibility.reason ?? null };
  }

  /**
   * The mill weighed it. Record what they said — alongside what we said, never over it.
   */
  async confirmDispatch(input: {
    dispatchId: string;
    confirmedWeightGrams: number;
    weighbridgeSlipRef: string | null;
    actorUserId: string;
  }): Promise<DispatchRecord> {
    const dispatch = await this.requireDispatch(input.dispatchId);
    const batch = await this.requireBatch(dispatch.batchId);

    applyBatchTransition(batch.status, 'CONFIRM');

    const discrepancy = calculateDiscrepancy({
      collectedWeightGrams: batch.collectedWeightGrams,
      confirmedWeightGrams: input.confirmedWeightGrams,
      tolerancePercent: this.config.get('WEIGHBRIDGE_TOLERANCE_PERCENT', { infer: true }),
    });

    if (discrepancy.flagged) {
      // Loud. A few percent is moisture; a large gap is spillage, a mis-keyed figure, or
      // theft — and the only way to tell which is for a human to look at it, soon.
      this.logger.error(
        `WEIGHBRIDGE DISCREPANCY on batch ${batch.reference}: we collected ` +
          `${batch.collectedWeightGrams} g, ${dispatch.partnerName} weighed ` +
          `${input.confirmedWeightGrams} g — ${discrepancy.discrepancyGrams} g ` +
          `(${discrepancy.discrepancyBps} bps, ${discrepancy.direction}). Needs investigation.`,
      );
    }

    return this.recycling.confirmDispatch({
      dispatchId: input.dispatchId,
      confirmedWeightGrams: input.confirmedWeightGrams,
      discrepancyGrams: discrepancy.discrepancyGrams,
      discrepancyBps: discrepancy.discrepancyBps,
      discrepancyFlagged: discrepancy.flagged,
      weighbridgeSlipRef: input.weighbridgeSlipRef,
      confirmedByUserId: input.actorUserId,
    });
  }

  async rejectDispatch(input: {
    dispatchId: string;
    reason: string;
    actorUserId: string;
  }): Promise<DispatchRecord> {
    await this.requireDispatch(input.dispatchId);

    this.logger.warn(`Dispatch ${input.dispatchId} REJECTED by the mill: ${input.reason}`);

    return this.recycling.rejectDispatch({
      dispatchId: input.dispatchId,
      reason: input.reason,
      confirmedByUserId: input.actorUserId,
    });
  }

  listFlaggedDispatches(): Promise<DispatchRecord[]> {
    return this.recycling.listFlaggedDispatches();
  }

  // --- Traceability ---------------------------------------------------------

  async chainOfCustody(batchId: string): Promise<ChainOfCustody & { itemsReconcile: boolean }> {
    const chain = await this.recycling.chainOfCustody(batchId);

    if (chain === null) {
      throw new NotFoundError('Batch not found');
    }

    // The batch's cached weight must equal the sum of its items — the same relationship the
    // wallet balance has to its ledger. If it does not, the chain of custody is not
    // trustworthy, and an ESG number built on it would be a number we cannot defend.
    const itemsReconcile = chain.totalItemWeightGrams === chain.batch.collectedWeightGrams;

    if (!itemsReconcile) {
      this.logger.error(
        `CHAIN OF CUSTODY MISMATCH on batch ${chain.batch.reference}: cached weight ` +
          `${chain.batch.collectedWeightGrams} g, items sum to ${chain.totalItemWeightGrams} g.`,
      );
    }

    return { ...chain, itemsReconcile };
  }

  traceCustomerPaper(userId: string) {
    return this.recycling.traceCustomerPaper(userId);
  }

  // --- Helpers --------------------------------------------------------------

  private async requireBatch(id: string): Promise<BatchRecord> {
    const batch = await this.recycling.findBatchById(id);

    if (batch === null) throw new NotFoundError('Batch not found');

    return batch;
  }

  private async requirePartner(id: string): Promise<RecyclingPartnerRecord> {
    const partner = await this.recycling.findPartnerById(id);

    if (partner === null) throw new NotFoundError('Recycling partner not found');

    return partner;
  }

  private async requireDispatch(id: string): Promise<DispatchRecord> {
    const dispatch = await this.recycling.findDispatchById(id);

    if (dispatch === null) throw new NotFoundError('Dispatch not found');

    return dispatch;
  }
}

export type { PaperType };
