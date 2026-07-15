import { type PaperType } from '@/modules/wallet/domain/money';
import { type BatchStatus } from '../batch-state-machine';
import { type BatchableItem, type BatchGroup } from '../batching';

export type PartnerStatus = 'PENDING' | 'VERIFIED' | 'SUSPENDED';
export type DispatchStatus = 'IN_TRANSIT' | 'CONFIRMED' | 'REJECTED';

export interface RecyclingPartnerRecord {
  id: string;
  name: string;
  status: PartnerStatus;
  acceptedPaperTypes: PaperType[];
  dailyCapacityGrams: number;
  city: string;
  state: string;
  pincode: string;
  addressLine: string;
  gstin: string | null;
  pollutionBoardId: string | null;
  contactName: string;
  contactPhone: string;
}

export interface BatchRecord {
  id: string;
  reference: string;
  zoneId: string;
  zoneName: string;
  paperType: PaperType;
  status: BatchStatus;
  collectedWeightGrams: number;
  itemCount: number;
  closedAt: Date | null;
  createdAt: Date;
}

export interface DispatchRecord {
  id: string;
  batchId: string;
  partnerId: string;
  partnerName: string;
  status: DispatchStatus;
  dispatchedAt: Date;
  transporterName: string;
  transporterVehicleNo: string;
  transporterContact: string;
  confirmedWeightGrams: number | null;
  discrepancyGrams: number | null;
  discrepancyBps: number | null;
  discrepancyFlagged: boolean;
  confirmedAt: Date | null;
  rejectionReason: string | null;
  weighbridgeSlipRef: string | null;
}

/**
 * The full chain of custody for a batch, in one shape.
 *
 * PickupItem -> CollectionBatch -> BatchDispatch -> RecyclingPartner.
 *
 * This is the object an ESG auditor is really asking for when they say "substantiate that
 * tonnage". Every gram is attributed to the customer who handed it over, the partner who
 * collected it, the batch it travelled in, the truck it travelled on, and the mill that
 * weighed it at the far end.
 */
export interface ChainOfCustody {
  batch: BatchRecord;
  dispatch: DispatchRecord | null;
  partner: RecyclingPartnerRecord | null;
  items: {
    pickupItemId: string;
    pickupId: string;
    customerId: string;
    paperType: PaperType;
    weightGrams: number;
    collectedAt: Date | null;
    collectedByPartnerId: string | null;
  }[];
  /** Sum of the item weights. Must equal batch.collectedWeightGrams — the API asserts it. */
  totalItemWeightGrams: number;
}

export interface RecyclingRepository {
  // --- Partners -------------------------------------------------------------

  createPartner(
    input: Omit<RecyclingPartnerRecord, 'id' | 'status'>,
  ): Promise<RecyclingPartnerRecord>;
  listPartners(status?: PartnerStatus): Promise<RecyclingPartnerRecord[]>;
  findPartnerById(id: string): Promise<RecyclingPartnerRecord | null>;
  updatePartner(
    id: string,
    input: Partial<Omit<RecyclingPartnerRecord, 'id'>> & { verifiedByUserId?: string },
  ): Promise<RecyclingPartnerRecord>;

  /** Grams already sent to this mill today — for the capacity check. */
  dispatchedToPartnerOnDateGrams(partnerId: string, date: Date): Promise<number>;

  // --- Batching -------------------------------------------------------------

  /**
   * Completed pickup items that are not yet in any batch.
   *
   * `batchId IS NULL` is the entire query — an explicit column, not an inferred join on
   * dates and zones. That is what makes the batching job idempotent and the chain of
   * custody a fact rather than a reconstruction.
   */
  listUnbatchedItems(): Promise<BatchableItem[]>;

  /**
   * Applies a batch group: finds or creates the OPEN batch for (zone, paperType), attaches
   * the items, and recomputes the batch's cached weight — in ONE transaction.
   *
   * Claiming items is a conditional update on `batchId IS NULL`, so two batching runs racing
   * cannot put the same item in two batches. An item in two batches would be counted twice
   * in Phase 6's tonnage, which is the single fastest way to lose an ESG audit.
   */
  applyBatchGroup(group: BatchGroup): Promise<BatchRecord>;

  listBatches(status?: BatchStatus): Promise<BatchRecord[]>;
  findBatchById(id: string): Promise<BatchRecord | null>;

  /** OPEN -> READY. Fixes the collected weight the weighbridge is compared against. */
  closeBatch(id: string): Promise<BatchRecord>;

  // --- Dispatch & confirmation ---------------------------------------------

  dispatch(input: {
    batchId: string;
    partnerId: string;
    transporterName: string;
    transporterVehicleNo: string;
    transporterContact: string;
  }): Promise<DispatchRecord>;

  /**
   * Records the mill's weighbridge reading ALONGSIDE our collected weight.
   *
   * Never on top of it. Both are real measurements by different parties with different
   * instruments, and the gap between them IS the finding. Overwrite one with the other and
   * the evidence that anything happened is gone.
   */
  confirmDispatch(input: {
    dispatchId: string;
    confirmedWeightGrams: number;
    discrepancyGrams: number;
    discrepancyBps: number;
    discrepancyFlagged: boolean;
    weighbridgeSlipRef: string | null;
    confirmedByUserId: string;
  }): Promise<DispatchRecord>;

  rejectDispatch(input: {
    dispatchId: string;
    reason: string;
    confirmedByUserId: string;
  }): Promise<DispatchRecord>;

  findDispatchById(id: string): Promise<DispatchRecord | null>;
  listFlaggedDispatches(): Promise<DispatchRecord[]>;

  // --- Traceability ---------------------------------------------------------

  chainOfCustody(batchId: string): Promise<ChainOfCustody | null>;

  /** The reverse walk: where did THIS customer's paper actually go? */
  traceCustomerPaper(userId: string): Promise<
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
  >;
}

export const RECYCLING_REPOSITORY = Symbol('RECYCLING_REPOSITORY');
