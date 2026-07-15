import { canDispatchTo, groupIntoBatches, type BatchableItem } from './batching';
import {
  applyBatchTransition,
  BATCH_ACTIONS,
  BATCH_STATUSES,
  canTransition,
  InvalidBatchTransitionError,
} from './batch-state-machine';

const MIN = 50_000; // 50 kg

const item = (overrides: Partial<BatchableItem> & { id: string }): BatchableItem => ({
  zoneId: 'zone-a',
  paperType: 'NEWSPAPER',
  weightGrams: 10_000,
  ...overrides,
});

describe('groupIntoBatches', () => {
  it('groups by zone AND paper type', () => {
    const groups = groupIntoBatches(
      [
        item({ id: 'i1', zoneId: 'zone-a', paperType: 'NEWSPAPER' }),
        item({ id: 'i2', zoneId: 'zone-a', paperType: 'NEWSPAPER' }),
        item({ id: 'i3', zoneId: 'zone-a', paperType: 'CARDBOARD' }),
        item({ id: 'i4', zoneId: 'zone-b', paperType: 'NEWSPAPER' }),
      ],
      MIN,
    );

    // A mill buys newsprint and cardboard as different products and weighs them separately,
    // so a truck of both is two loads sharing a chassis.
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => `${group.zoneId}:${group.paperType}`)).toEqual([
      'zone-a:CARDBOARD',
      'zone-a:NEWSPAPER',
      'zone-b:NEWSPAPER',
    ]);
  });

  it('splits ONE pickup’s paper types into different batches', () => {
    // A customer hands over newspapers and cardboard in one go. Those two go to different
    // batches, possibly to different mills — and the chain of custody must still be able to
    // answer "where did THIS customer's cardboard end up" separately from their newsprint.
    const groups = groupIntoBatches(
      [
        item({ id: 'i1', paperType: 'NEWSPAPER', weightGrams: 5000 }),
        item({ id: 'i2', paperType: 'CARDBOARD', weightGrams: 3000 }),
      ],
      MIN,
    );

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.itemIds.length === 1)).toBe(true);
  });

  it('sums the weights of everything in a group', () => {
    const groups = groupIntoBatches(
      [
        item({ id: 'i1', weightGrams: 12_345 }),
        item({ id: 'i2', weightGrams: 7_655 }),
        item({ id: 'i3', weightGrams: 30_000 }),
      ],
      MIN,
    );

    expect(groups[0]?.totalWeightGrams).toBe(50_000);
    expect(groups[0]?.itemIds).toHaveLength(3);
  });

  describe('the dispatch threshold', () => {
    it('does not mark a small batch ready — and that is NOT an error', () => {
      // A lorry to a mill costs the same whether it carries 5 kg or 500 kg. Dispatching tiny
      // batches destroys the unit economics of the whole model, and paper keeps fine in a
      // warehouse. The batch stays open and keeps growing; nobody is alerted.
      const groups = groupIntoBatches([item({ id: 'i1', weightGrams: 5_000 })], MIN);

      expect(groups[0]?.readyToDispatch).toBe(false);
      expect(groups[0]?.totalWeightGrams).toBe(5_000);
    });

    it('marks a batch ready at EXACTLY the threshold', () => {
      const groups = groupIntoBatches([item({ id: 'i1', weightGrams: MIN })], MIN);

      expect(groups[0]?.readyToDispatch).toBe(true);
    });

    it('does not mark a batch ready one gram below the threshold', () => {
      const groups = groupIntoBatches([item({ id: 'i1', weightGrams: MIN - 1 })], MIN);

      expect(groups[0]?.readyToDispatch).toBe(false);
    });

    it('judges each group on its OWN weight, not the total', () => {
      // The cardboard is nowhere near dispatchable even though the newsprint is. Judging on
      // the combined total would put a nearly-empty cardboard load on a truck.
      const groups = groupIntoBatches(
        [
          item({ id: 'i1', paperType: 'NEWSPAPER', weightGrams: 60_000 }),
          item({ id: 'i2', paperType: 'CARDBOARD', weightGrams: 1_000 }),
        ],
        MIN,
      );

      const newspaper = groups.find((group) => group.paperType === 'NEWSPAPER');
      const cardboard = groups.find((group) => group.paperType === 'CARDBOARD');

      expect(newspaper?.readyToDispatch).toBe(true);
      expect(cardboard?.readyToDispatch).toBe(false);
    });
  });

  it('produces nothing from no items', () => {
    expect(groupIntoBatches([], MIN)).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      item({ id: 'i3', zoneId: 'zone-b' }),
      item({ id: 'i1', zoneId: 'zone-a' }),
      item({ id: 'i2', zoneId: 'zone-a', paperType: 'CARDBOARD' }),
    ];

    // A dispute about which mill a customer's paper went to must have ONE answer.
    const forward = groupIntoBatches(items, MIN);
    const reversed = groupIntoBatches([...items].reverse(), MIN);

    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });
});

describe('canDispatchTo', () => {
  const mill = {
    status: 'VERIFIED' as const,
    acceptedPaperTypes: ['NEWSPAPER', 'CARDBOARD'] as const,
    dailyCapacityGrams: 1_000_000,
  };

  const batch = { paperType: 'NEWSPAPER' as const, collectedWeightGrams: 100_000 };

  it('allows a verified mill that accepts the paper type', () => {
    expect(canDispatchTo(mill, batch, 0).eligible).toBe(true);
  });

  it.each(['PENDING', 'SUSPENDED'] as const)('refuses a %s partner', (status) => {
    // The same rule as delivery-partner KYC: an unverified mill is a stranger we would be
    // handing tonnes of customers' property to, and a chain of custody is only worth
    // anything if every link was checked.
    const result = canDispatchTo({ ...mill, status }, batch, 0);

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/VERIFIED/);
  });

  it('refuses a paper type the mill does not accept', () => {
    // Otherwise the lorry arrives and is turned away — a day, a driver, and the
    // relationship, all gone.
    const result = canDispatchTo(
      { ...mill, acceptedPaperTypes: ['CARDBOARD'] },
      { paperType: 'NEWSPAPER', collectedWeightGrams: 100_000 },
      0,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/does not accept NEWSPAPER/);
  });

  it('warns about capacity but still allows the dispatch', () => {
    // Advisory, not fatal. A mill briefly over its stated ceiling will usually still take
    // the load, and refusing outright would strand paper because of a number somebody typed
    // into a form months ago. The human dispatching gets told, and can phone them.
    const result = canDispatchTo(mill, batch, 950_000);

    expect(result.eligible).toBe(true);
    expect(result.reason).toMatch(/WARNING.*capacity/i);
  });

  it('does not warn when the load fits', () => {
    expect(canDispatchTo(mill, batch, 100_000).reason).toBeUndefined();
  });
});

describe('batch state machine', () => {
  it('follows the chain: OPEN -> READY -> DISPATCHED -> CONFIRMED', () => {
    expect(applyBatchTransition('OPEN', 'ADD_ITEM')).toBe('OPEN');
    expect(applyBatchTransition('OPEN', 'CLOSE')).toBe('READY');
    expect(applyBatchTransition('READY', 'DISPATCH')).toBe('DISPATCHED');
    expect(applyBatchTransition('DISPATCHED', 'CONFIRM')).toBe('CONFIRMED');
  });

  it('cannot add an item to a batch that has left the warehouse', () => {
    // An item added after the manifest is written is paper the mill will weigh and the
    // paperwork does not mention — which is a discrepancy we manufactured ourselves.
    expect(() => applyBatchTransition('READY', 'ADD_ITEM')).toThrow(InvalidBatchTransitionError);
    expect(() => applyBatchTransition('DISPATCHED', 'ADD_ITEM')).toThrow(
      InvalidBatchTransitionError,
    );
  });

  it('cannot dispatch without closing first', () => {
    // Closing is what FIXES the collected weight the weighbridge will be compared against.
    // Skip it and the batch could still be growing while the truck is on the road.
    expect(() => applyBatchTransition('OPEN', 'DISPATCH')).toThrow(InvalidBatchTransitionError);
  });

  it('cannot dispatch a batch twice', () => {
    expect(() => applyBatchTransition('DISPATCHED', 'DISPATCH')).toThrow(
      InvalidBatchTransitionError,
    );
  });

  it.each(BATCH_ACTIONS)('CONFIRMED is terminal: refuses %s', (action) => {
    // The weighbridge reading is the last word, and the discrepancy between it and our
    // collected weight is evidence — not a draft to be revised.
    expect(canTransition('CONFIRMED', action)).toBe(false);
  });

  it('has an explicit entry for every state/action pair', () => {
    for (const status of BATCH_STATUSES) {
      for (const action of BATCH_ACTIONS) {
        expect(typeof canTransition(status, action)).toBe('boolean');
      }
    }
  });
});
