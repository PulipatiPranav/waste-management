import { type PaperType } from '@/modules/wallet/domain/money';

/**
 * Groups unbatched pickup items into collection batches.
 *
 * A pure function: items in, groups out. No database, no clock. The interesting cases —
 * a batch too small to dispatch, an item whose zone has no batch yet, two paper types from
 * one pickup going to different mills — are all arithmetic, and arithmetic is testable.
 *
 * GROUPING IS DELIBERATELY SIMPLE: one batch per (zone, paper type). Nothing here does
 * nearest-mill routing, load consolidation across adjacent zones, capacity-aware packing,
 * or truck-fill optimisation. Those are all real and all worth doing, and none of them can
 * be designed sensibly before real mills are quoting real prices for real load sizes.
 * Doing them now would be inventing constraints. This is a documented future enhancement,
 * not an oversight.
 */

export interface BatchableItem {
  id: string;
  /** Where it was collected. A batch never mixes zones — a truck goes to one area. */
  zoneId: string;
  paperType: PaperType;
  weightGrams: number;
}

export interface BatchGroup {
  zoneId: string;
  paperType: PaperType;
  itemIds: string[];
  totalWeightGrams: number;
  /**
   * Whether this group is worth putting on a truck.
   *
   * A lorry to a mill costs roughly the same whether it carries 50 kg or 500 kg, so
   * dispatching tiny batches destroys the unit economics of the entire circular model —
   * and paper keeps perfectly well in a warehouse. Below the threshold the batch stays
   * OPEN and keeps accumulating; it is not an error, and nobody should be alerted.
   */
  readyToDispatch: boolean;
}

export function groupIntoBatches(
  items: readonly BatchableItem[],
  minimumDispatchWeightGrams: number,
): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();

  // Deterministic order: the same items always produce the same batches, so a dispute about
  // which mill a customer's paper went to has one answer, not a probable one.
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));

  for (const item of ordered) {
    const key = `${item.zoneId}:${item.paperType}`;

    const group = groups.get(key) ?? {
      zoneId: item.zoneId,
      paperType: item.paperType,
      itemIds: [],
      totalWeightGrams: 0,
      readyToDispatch: false,
    };

    group.itemIds.push(item.id);
    group.totalWeightGrams += item.weightGrams;

    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.readyToDispatch = group.totalWeightGrams >= minimumDispatchWeightGrams;
  }

  return [...groups.values()].sort(
    (a, b) => a.zoneId.localeCompare(b.zoneId) || a.paperType.localeCompare(b.paperType),
  );
}

/**
 * Can this mill take this batch?
 *
 * Checked BEFORE a truck is loaded, because the failure mode otherwise is a lorry arriving
 * at a gate and being turned away — which costs a day, a driver, and the relationship.
 */
export interface DispatchEligibility {
  eligible: boolean;
  reason?: string;
}

export function canDispatchTo(
  partner: {
    status: 'PENDING' | 'VERIFIED' | 'SUSPENDED';
    acceptedPaperTypes: readonly PaperType[];
    dailyCapacityGrams: number;
  },
  batch: { paperType: PaperType; collectedWeightGrams: number },
  alreadyDispatchedToPartnerTodayGrams: number,
): DispatchEligibility {
  if (partner.status !== 'VERIFIED') {
    // The same rule as delivery-partner KYC, for the same reason: an unverified mill is a
    // stranger we are handing several tonnes of a customer's property to, and the chain of
    // custody is only worth anything if every link in it was checked.
    return { eligible: false, reason: `The recycling partner is ${partner.status}, not VERIFIED.` };
  }

  if (!partner.acceptedPaperTypes.includes(batch.paperType)) {
    return {
      eligible: false,
      reason: `This partner does not accept ${batch.paperType}. The truck would be turned away at the gate.`,
    };
  }

  const wouldTotal = alreadyDispatchedToPartnerTodayGrams + batch.collectedWeightGrams;

  if (wouldTotal > partner.dailyCapacityGrams) {
    // Advisory, not fatal — a mill briefly over its stated ceiling will usually still take
    // the load, and refusing outright would strand paper for a number somebody typed into a
    // form months ago. So this is surfaced to the human dispatching, who can call them.
    return {
      eligible: true,
      reason:
        `WARNING: this would put the partner at ${wouldTotal} g against a stated daily capacity ` +
        `of ${partner.dailyCapacityGrams} g. Confirm with the mill before the truck leaves.`,
    };
  }

  return { eligible: true };
}
