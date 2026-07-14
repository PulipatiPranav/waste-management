import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import {
  isDueOn,
  planRuns,
  type PlannablePartner,
  type PlannableSubscription,
  type PlannableZone,
} from './run-planner';

/** 2026-07-14 is a Tuesday. 2026-07-19 is a Sunday. */
const TUESDAY = Day.parse('2026-07-14');
const SUNDAY = Day.parse('2026-07-19');

const sub = (
  overrides: Partial<PlannableSubscription> & { id: string },
): PlannableSubscription => ({
  addressId: `addr-${overrides.id}`,
  pincode: '560038',
  frequency: 'DAILY',
  status: 'ACTIVE',
  startDate: Day.parse('2026-01-01'),
  cancelledOn: null,
  pauses: [],
  ...overrides,
});

const zone = (overrides: Partial<PlannableZone> & { id: string }): PlannableZone => ({
  name: `Zone ${overrides.id}`,
  pincodes: ['560038'],
  isActive: true,
  ...overrides,
});

const partner = (overrides: Partial<PlannablePartner> & { id: string }): PlannablePartner => ({
  zoneIds: ['zone-a'],
  isActive: true,
  isAvailable: true,
  kycStatus: 'VERIFIED',
  ...overrides,
});

const plan = (
  subscriptions: PlannableSubscription[],
  zones: PlannableZone[],
  partners: PlannablePartner[],
  runDate = TUESDAY,
) => planRuns({ runDate, subscriptions, zones, partners });

describe('isDueOn', () => {
  it('is due for an ACTIVE daily subscription', () => {
    expect(isDueOn(sub({ id: 's1' }), TUESDAY)).toBe(true);
  });

  it.each(['PAUSED', 'CANCELLED'] as const)('is not due when %s', (status) => {
    expect(isDueOn(sub({ id: 's1', status }), TUESDAY)).toBe(false);
  });

  it('is not due before the start date', () => {
    expect(isDueOn(sub({ id: 's1', startDate: Day.parse('2026-07-15') }), TUESDAY)).toBe(false);
  });

  it('is due ON the start date', () => {
    expect(isDueOn(sub({ id: 's1', startDate: TUESDAY }), TUESDAY)).toBe(true);
  });

  it('is due ON the cancellation date but not after', () => {
    // The customer gets that morning's paper — and Phase 2 bills them for it. The two
    // must agree, or we deliver a paper we never charged for (or worse, the reverse).
    expect(isDueOn(sub({ id: 's1', status: 'ACTIVE', cancelledOn: TUESDAY }), TUESDAY)).toBe(true);
    expect(
      isDueOn(sub({ id: 's1', status: 'ACTIVE', cancelledOn: Day.parse('2026-07-13') }), TUESDAY),
    ).toBe(false);
  });

  describe('frequency', () => {
    it('does not deliver a SUNDAY_ONLY subscription on a Tuesday', () => {
      expect(isDueOn(sub({ id: 's1', frequency: 'SUNDAY_ONLY' }), TUESDAY)).toBe(false);
      expect(isDueOn(sub({ id: 's1', frequency: 'SUNDAY_ONLY' }), SUNDAY)).toBe(true);
    });

    it('does not deliver a WEEKDAYS subscription on a Sunday', () => {
      expect(isDueOn(sub({ id: 's1', frequency: 'WEEKDAYS' }), SUNDAY)).toBe(false);
      expect(isDueOn(sub({ id: 's1', frequency: 'WEEKDAYS' }), TUESDAY)).toBe(true);
    });
  });

  describe('pause windows', () => {
    it('is not due inside an open pause', () => {
      const paused = sub({
        id: 's1',
        pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: null }],
      });

      expect(isDueOn(paused, TUESDAY)).toBe(false);
    });

    it('is due again from resumedFrom, inclusive', () => {
      const resumed = sub({
        id: 's1',
        pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: TUESDAY }],
      });

      // resumedFrom is the first DELIVERED day — the same reading Phase 2's proration
      // uses. Reading it as the last paused day would skip a paper the customer paid for.
      expect(isDueOn(resumed, TUESDAY)).toBe(true);
      expect(isDueOn(resumed, Day.parse('2026-07-13'))).toBe(false);
    });

    it('is not due inside a closed pause that contains the day', () => {
      const paused = sub({
        id: 's1',
        pauses: [{ pausedFrom: Day.parse('2026-07-10'), resumedFrom: Day.parse('2026-07-20') }],
      });

      expect(isDueOn(paused, TUESDAY)).toBe(false);
    });
  });
});

describe('planRuns', () => {
  it('assigns a due subscription to the only partner in its zone', () => {
    const result = plan([sub({ id: 's1' })], [zone({ id: 'zone-a' })], [partner({ id: 'p1' })]);

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ zoneId: 'zone-a', partnerId: 'p1' });
    expect(result.runs[0]?.stops).toEqual([
      { subscriptionId: 's1', addressId: 'addr-s1', sequence: 1 },
    ]);
    expect(result.unassigned).toEqual([]);
  });

  it('sequences stops from 1', () => {
    const result = plan(
      [sub({ id: 's1' }), sub({ id: 's2' })],
      [zone({ id: 'zone-a' })],
      [partner({ id: 'p1' })],
    );

    expect(result.runs[0]?.stops.map((stop) => stop.sequence)).toEqual([1, 2]);
  });

  it('does not plan a stop for a subscription that is not due', () => {
    const result = plan(
      [
        sub({ id: 's-active' }),
        sub({ id: 's-paused', status: 'PAUSED' }),
        sub({ id: 's-cancelled', status: 'CANCELLED' }),
        sub({ id: 's-sunday', frequency: 'SUNDAY_ONLY' }),
        sub({ id: 's-future', startDate: Day.parse('2026-08-01') }),
      ],
      [zone({ id: 'zone-a' })],
      [partner({ id: 'p1' })],
    );

    expect(result.runs[0]?.stops.map((stop) => stop.subscriptionId)).toEqual(['s-active']);
    // And none of them are reported unassigned — they are simply not due, which is not
    // a failure and must not page anybody.
    expect(result.unassigned).toEqual([]);
  });

  describe('zero available partners', () => {
    it('reports NO_PARTNER rather than silently dropping the customer', () => {
      const result = plan([sub({ id: 's1' })], [zone({ id: 'zone-a' })], []);

      expect(result.runs).toEqual([]);
      expect(result.unassigned).toEqual([
        { subscriptionId: 's1', pincode: '560038', zoneId: 'zone-a', reason: 'NO_PARTNER' },
      ]);
    });

    it.each([
      ['offboarded', { isActive: false }],
      ['on leave', { isAvailable: false }],
      ['KYC pending', { kycStatus: 'PENDING' as const }],
      ['KYC rejected', { kycStatus: 'REJECTED' as const }],
    ])('treats a %s partner as unavailable', (_label, overrides) => {
      const result = plan(
        [sub({ id: 's1' })],
        [zone({ id: 'zone-a' })],
        [partner({ id: 'p1', ...overrides })],
      );

      expect(result.runs).toEqual([]);
      expect(result.unassigned[0]?.reason).toBe('NO_PARTNER');
    });

    it('never gives work to an unverified partner even when nobody else can do it', () => {
      // The tempting "just let them work until KYC comes through" is exactly what KYC
      // exists to prevent: an unvetted stranger with a list of customers' home addresses.
      const result = plan(
        [sub({ id: 's1' })],
        [zone({ id: 'zone-a' })],
        [partner({ id: 'p1', kycStatus: 'PENDING' })],
      );

      expect(result.runs).toEqual([]);
    });
  });

  describe('no zone covers the pincode', () => {
    it('reports NO_ZONE', () => {
      const result = plan(
        [sub({ id: 's1', pincode: '999999' })],
        [zone({ id: 'zone-a' })],
        [partner({ id: 'p1' })],
      );

      expect(result.unassigned).toEqual([
        { subscriptionId: 's1', pincode: '999999', zoneId: null, reason: 'NO_ZONE' },
      ]);
    });

    it('ignores an inactive zone', () => {
      const result = plan(
        [sub({ id: 's1' })],
        [zone({ id: 'zone-a', isActive: false })],
        [partner({ id: 'p1' })],
      );

      expect(result.unassigned[0]?.reason).toBe('NO_ZONE');
    });
  });

  describe('overlapping zones', () => {
    it('creates exactly ONE stop when a pincode is in two zones', () => {
      const result = plan(
        [sub({ id: 's1', pincode: '560038' })],
        [
          zone({ id: 'zone-a', pincodes: ['560038'] }),
          zone({ id: 'zone-b', pincodes: ['560038'] }),
        ],
        [partner({ id: 'p1', zoneIds: ['zone-a'] }), partner({ id: 'p2', zoneIds: ['zone-b'] })],
      );

      // Two stops would mean the customer gets two papers and the company pays two
      // partners for one delivery.
      const stops = result.runs.flatMap((run) => run.stops);
      expect(stops).toHaveLength(1);
      expect(result.runs).toHaveLength(1);
    });

    it('resolves the tie deterministically and reports the ambiguity', () => {
      const zones = [
        zone({ id: 'zone-b', pincodes: ['560038'] }),
        zone({ id: 'zone-a', pincodes: ['560038'] }),
      ];
      const partners = [
        partner({ id: 'p1', zoneIds: ['zone-a'] }),
        partner({ id: 'p2', zoneIds: ['zone-b'] }),
      ];

      const first = plan([sub({ id: 's1' })], zones, partners);
      const second = plan([sub({ id: 's1' })], [...zones].reverse(), partners);

      // Same input, same plan — regardless of the order rows came back from the DB.
      // A non-deterministic job produces a different run sheet every night and nobody
      // can reproduce a complaint.
      expect(first.runs[0]?.zoneId).toBe('zone-a');
      expect(second.runs[0]?.zoneId).toBe('zone-a');

      // Ops has a data problem: the same pincode is in two zones. Not fatal, but said.
      expect(first.ambiguousPincodes).toEqual(['560038']);
    });
  });

  describe('load balancing', () => {
    it('spreads stops evenly across partners in a zone', () => {
      const subscriptions = Array.from({ length: 9 }, (_, i) => sub({ id: `s${i + 1}` }));
      const partners = [partner({ id: 'p1' }), partner({ id: 'p2' }), partner({ id: 'p3' })];

      const result = plan(subscriptions, [zone({ id: 'zone-a' })], partners);

      const loads = result.runs.map((run) => run.stops.length).sort();
      expect(loads).toEqual([3, 3, 3]);
    });

    it('splits an odd number of stops as evenly as possible', () => {
      const subscriptions = Array.from({ length: 7 }, (_, i) => sub({ id: `s${i + 1}` }));

      const result = plan(
        subscriptions,
        [zone({ id: 'zone-a' })],
        [partner({ id: 'p1' }), partner({ id: 'p2' })],
      );

      const loads = result.runs.map((run) => run.stops.length).sort();
      expect(loads).toEqual([3, 4]);
    });

    it('balances a partner’s TOTAL load across the zones they work', () => {
      // p1 works both zones, p2 only zone-b. Balancing per-zone would give p1 a full
      // load in zone-a AND half of zone-b — double the round of anyone else. The count
      // has to be global to the partner, which is the whole point.
      const subscriptions = [
        ...Array.from({ length: 4 }, (_, i) => sub({ id: `a${i}`, pincode: '560001' })),
        ...Array.from({ length: 4 }, (_, i) => sub({ id: `b${i}`, pincode: '560002' })),
      ];

      const result = plan(
        subscriptions,
        [
          zone({ id: 'zone-a', pincodes: ['560001'] }),
          zone({ id: 'zone-b', pincodes: ['560002'] }),
        ],
        [
          partner({ id: 'p1', zoneIds: ['zone-a', 'zone-b'] }),
          partner({ id: 'p2', zoneIds: ['zone-b'] }),
        ],
      );

      const totalByPartner = new Map<string, number>();
      for (const run of result.runs) {
        totalByPartner.set(
          run.partnerId,
          (totalByPartner.get(run.partnerId) ?? 0) + run.stops.length,
        );
      }

      // p1 must take all 4 of zone-a (only they serve it), so zone-b's 4 go mostly to
      // p2 to even things out: 4 + 4 = 8 stops, split as evenly as the constraint allows.
      expect(totalByPartner.get('p1')).toBe(4);
      expect(totalByPartner.get('p2')).toBe(4);
    });

    it('gives every stop to the sole partner when there is only one', () => {
      const subscriptions = Array.from({ length: 5 }, (_, i) => sub({ id: `s${i}` }));

      const result = plan(subscriptions, [zone({ id: 'zone-a' })], [partner({ id: 'p1' })]);

      expect(result.runs).toHaveLength(1);
      expect(result.runs[0]?.stops).toHaveLength(5);
    });
  });

  describe('one run per partner per zone', () => {
    it('groups a partner’s stops in a zone into a single run', () => {
      const subscriptions = Array.from({ length: 3 }, (_, i) => sub({ id: `s${i}` }));

      const result = plan(subscriptions, [zone({ id: 'zone-a' })], [partner({ id: 'p1' })]);

      expect(result.runs).toHaveLength(1);
    });

    it('gives a partner working two zones one run per zone', () => {
      const result = plan(
        [sub({ id: 's1', pincode: '560001' }), sub({ id: 's2', pincode: '560002' })],
        [
          zone({ id: 'zone-a', pincodes: ['560001'] }),
          zone({ id: 'zone-b', pincodes: ['560002'] }),
        ],
        [partner({ id: 'p1', zoneIds: ['zone-a', 'zone-b'] })],
      );

      // Two run sheets, because they are two different areas — even though it is one
      // partner and one day.
      expect(result.runs).toHaveLength(2);
      expect(result.runs.every((run) => run.partnerId === 'p1')).toBe(true);
    });
  });

  it('is deterministic: the same inputs in any order produce the same plan', () => {
    const subscriptions = Array.from({ length: 6 }, (_, i) => sub({ id: `s${i}` }));
    const zones = [zone({ id: 'zone-a' })];
    const partners = [partner({ id: 'p1' }), partner({ id: 'p2' })];

    const forward = plan(subscriptions, zones, partners);
    const reversed = plan([...subscriptions].reverse(), zones, [...partners].reverse());

    expect(JSON.stringify(forward.runs)).toBe(JSON.stringify(reversed.runs));
  });

  it('plans nothing at all on a day with no due subscriptions', () => {
    const result = plan(
      [sub({ id: 's1', frequency: 'SUNDAY_ONLY' })],
      [zone({ id: 'zone-a' })],
      [partner({ id: 'p1' })],
      TUESDAY,
    );

    expect(result.runs).toEqual([]);
    expect(result.unassigned).toEqual([]);
  });
});
