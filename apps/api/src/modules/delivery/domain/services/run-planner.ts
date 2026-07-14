import { type Day } from '@/modules/subscriptions/domain/value-objects/day';
import {
  isDeliveryDay,
  type DeliveryFrequency,
} from '@/modules/subscriptions/domain/value-objects/delivery-frequency';
import { type PauseWindow } from '@/modules/subscriptions/domain/services/proration.service';

/**
 * The nightly assignment planner.
 *
 * A PURE function: subscriptions + zones + partners + a date in, a plan out. No
 * database, no clock, no queue. That is deliberate — this is the piece of Phase 3 most
 * likely to be wrong (partners in overlapping zones, a zone with no partners, a
 * SUNDAY_ONLY subscriber on a Tuesday), and every one of those cases is testable here
 * as arithmetic rather than as a fixture and a job run.
 *
 * ROUTE OPTIMISATION IS NOT BUILT. Stops are sequenced in insertion order. Real routing
 * (travel time, one-way streets, a TSP solver or an external routing service) is a
 * documented future enhancement — it needs geocoded addresses, which we do not collect
 * yet, and it would be premature before real partners have walked real routes.
 */

export interface PlannableSubscription {
  id: string;
  addressId: string;
  /** The delivery address's pincode. Snapshotted here so the planner never queries. */
  pincode: string;
  frequency: DeliveryFrequency;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  startDate: Day;
  cancelledOn: Day | null;
  pauses: readonly PauseWindow[];
}

export interface PlannableZone {
  id: string;
  name: string;
  pincodes: readonly string[];
  isActive: boolean;
}

export interface PlannablePartner {
  id: string;
  zoneIds: readonly string[];
  isActive: boolean;
  isAvailable: boolean;
  kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface PlannedStop {
  subscriptionId: string;
  addressId: string;
  sequence: number;
}

export interface PlannedRun {
  zoneId: string;
  partnerId: string;
  stops: PlannedStop[];
}

export type UnassignedReason =
  /** No active zone lists this subscription's pincode. Ops must extend a zone. */
  | 'NO_ZONE'
  /** The zone exists but has no partner who is active, available and KYC-verified. */
  | 'NO_PARTNER';

export interface UnassignedSubscription {
  subscriptionId: string;
  pincode: string;
  zoneId: string | null;
  reason: UnassignedReason;
}

export interface RunPlan {
  runDate: Day;
  runs: PlannedRun[];
  /**
   * Subscriptions that could NOT be assigned.
   *
   * Returned rather than swallowed. A customer silently dropped from the run sheet is
   * a customer who is billed and receives nothing — the failure mode that looks like
   * success to everybody until they complain. The job logs these loudly, and Phase 9's
   * ops dashboard should surface them.
   */
  unassigned: UnassignedSubscription[];
  /** Pincodes found in more than one active zone. Ops has a data problem; not fatal. */
  ambiguousPincodes: string[];
}

/**
 * Is an issue due for this subscription on this day?
 *
 * Reuses the Phase 2 billing calendar ON PURPOSE. If delivery used its own notion of
 * "is today a delivery day", the two would drift, and the system would bill for issues
 * it never printed a run sheet for — or print run sheets for issues it never billed.
 * One calendar, both answers.
 */
export function isDueOn(subscription: PlannableSubscription, day: Day): boolean {
  if (subscription.status !== 'ACTIVE') return false;

  if (day.isBefore(subscription.startDate)) return false;

  if (subscription.cancelledOn !== null && day.isAfter(subscription.cancelledOn)) return false;

  if (!isDeliveryDay(subscription.frequency, day)) return false;

  // Belt and braces alongside the ACTIVE check: an open pause window on a subscription
  // whose status says ACTIVE is an inconsistency, and delivering into it would mean
  // giving away a paper the customer is explicitly not being billed for.
  for (const pause of subscription.pauses) {
    const startedOnOrBefore = !pause.pausedFrom.isAfter(day);
    const notYetResumed = pause.resumedFrom === null || day.isBefore(pause.resumedFrom);

    if (startedOnOrBefore && notYetResumed) return false;
  }

  return true;
}

/**
 * The zone serving a pincode.
 *
 * A pincode CAN appear in two zones — ops can and will draw overlapping areas. The
 * planner must still produce exactly one stop for the customer, so the tie is broken
 * deterministically (lowest zone id) and reported. Picking arbitrarily would make the
 * nightly job non-deterministic: the same input would produce different run sheets on
 * different nights, and nobody could reproduce a complaint.
 */
function resolveZone(
  pincode: string,
  zones: readonly PlannableZone[],
): { zone: PlannableZone | null; ambiguous: boolean } {
  const matches = zones
    .filter((zone) => zone.isActive && zone.pincodes.includes(pincode))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { zone: matches[0] ?? null, ambiguous: matches.length > 1 };
}

function isEligible(partner: PlannablePartner): boolean {
  // KYC-verified only. An unverified partner is a stranger with a list of customers'
  // home addresses — that is the whole point of collecting KYC, and letting them work
  // "just until verification comes through" defeats it entirely.
  return partner.isActive && partner.isAvailable && partner.kycStatus === 'VERIFIED';
}

export function planRuns(input: {
  runDate: Day;
  subscriptions: readonly PlannableSubscription[];
  zones: readonly PlannableZone[];
  partners: readonly PlannablePartner[];
}): RunPlan {
  const { runDate, subscriptions, zones, partners } = input;

  const due = subscriptions.filter((subscription) => isDueOn(subscription, runDate));

  const eligiblePartners = partners.filter(isEligible);

  /**
   * Stops assigned to each partner today, ACROSS ALL ZONES.
   *
   * Counted globally, not per zone, because a partner who works two zones would
   * otherwise be given a full load in each and end up with double the round. This is
   * the "partners in overlapping zones" bug the brief warns about, and per-zone
   * round-robin walks straight into it.
   */
  const loadByPartner = new Map<string, number>(eligiblePartners.map((p) => [p.id, 0]));

  // Keyed `zoneId:partnerId`; each becomes one DailyDeliveryRun row.
  const runsByKey = new Map<string, PlannedRun>();
  const unassigned: UnassignedSubscription[] = [];
  const ambiguousPincodes = new Set<string>();

  // Deterministic input order, so the same night's data always yields the same plan.
  const ordered = [...due].sort((a, b) => a.id.localeCompare(b.id));

  for (const subscription of ordered) {
    const { zone, ambiguous } = resolveZone(subscription.pincode, zones);

    if (ambiguous) ambiguousPincodes.add(subscription.pincode);

    if (zone === null) {
      unassigned.push({
        subscriptionId: subscription.id,
        pincode: subscription.pincode,
        zoneId: null,
        reason: 'NO_ZONE',
      });
      continue;
    }

    const candidates = eligiblePartners.filter((partner) => partner.zoneIds.includes(zone.id));

    if (candidates.length === 0) {
      unassigned.push({
        subscriptionId: subscription.id,
        pincode: subscription.pincode,
        zoneId: zone.id,
        reason: 'NO_PARTNER',
      });
      continue;
    }

    // Least-loaded wins; partner id breaks ties. Plain round-robin (cycling an index)
    // would be wrong here: partners join different sets of zones, so the cycle would
    // hand work to a partner who does not serve this zone, or skew load when one
    // partner appears in two zones' cycles.
    const chosen = candidates.reduce((best, partner) => {
      const bestLoad = loadByPartner.get(best.id) ?? 0;
      const load = loadByPartner.get(partner.id) ?? 0;

      if (load !== bestLoad) return load < bestLoad ? partner : best;

      return partner.id < best.id ? partner : best;
    });

    loadByPartner.set(chosen.id, (loadByPartner.get(chosen.id) ?? 0) + 1);

    const key = `${zone.id}:${chosen.id}`;
    let run = runsByKey.get(key);

    if (run === undefined) {
      run = { zoneId: zone.id, partnerId: chosen.id, stops: [] };
      runsByKey.set(key, run);
    }

    run.stops.push({
      subscriptionId: subscription.id,
      addressId: subscription.addressId,
      // Insertion order. Route optimisation is a documented future enhancement.
      sequence: run.stops.length + 1,
    });
  }

  return {
    runDate,
    runs: [...runsByKey.values()],
    unassigned,
    ambiguousPincodes: [...ambiguousPincodes].sort(),
  };
}
