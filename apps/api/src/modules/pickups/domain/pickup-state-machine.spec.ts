import {
  applyPickupTransition,
  canTransition,
  InvalidPickupTransitionError,
  PICKUP_ACTIONS,
  PICKUP_STATUSES,
  type PickupAction,
  type PickupStatus,
} from './pickup-state-machine';

describe('pickup state machine', () => {
  const legal: [PickupStatus, PickupAction, PickupStatus][] = [
    ['REQUESTED', 'ASSIGN', 'ASSIGNED'],
    ['REQUESTED', 'CANCEL', 'CANCELLED'],
    ['ASSIGNED', 'COMPLETE', 'COMPLETED'],
    ['ASSIGNED', 'CANCEL', 'CANCELLED'],
  ];

  it.each(legal)('%s + %s -> %s', (from, action, expected) => {
    expect(applyPickupTransition(from, action)).toBe(expected);
  });

  it('cannot complete a pickup that was never assigned', () => {
    // Nobody has been authorised to weigh it, and the QR scan — the proof a partner was
    // actually at the door — has not happened.
    expect(() => applyPickupTransition('REQUESTED', 'COMPLETE')).toThrow(
      InvalidPickupTransitionError,
    );
  });

  describe('COMPLETED is terminal', () => {
    // The most important property in this table. A completed pickup has already credited
    // the customer's wallet, and the ledger is append-only. "Re-completing" it could only
    // ever mean paying twice.
    it.each(PICKUP_ACTIONS)('refuses %s', (action) => {
      expect(canTransition('COMPLETED', action)).toBe(false);
      expect(() => applyPickupTransition('COMPLETED', action)).toThrow(
        InvalidPickupTransitionError,
      );
    });

    it('cannot be cancelled after the cashback has been paid', () => {
      expect(() => applyPickupTransition('COMPLETED', 'CANCEL')).toThrow(/cancel.*COMPLETED/i);
    });
  });

  it.each(PICKUP_ACTIONS)('CANCELLED is terminal: refuses %s', (action) => {
    expect(canTransition('CANCELLED', action)).toBe(false);
  });

  it('can be cancelled after assignment — the customer may not be home', () => {
    expect(applyPickupTransition('ASSIGNED', 'CANCEL')).toBe('CANCELLED');
  });

  it('has an explicit entry for every state/action pair', () => {
    // Guards against a new status being added to the enum but not the table, which would
    // surface as `undefined !== null` — i.e. silently ALLOWED — at runtime.
    for (const status of PICKUP_STATUSES) {
      for (const action of PICKUP_ACTIONS) {
        expect(typeof canTransition(status, action)).toBe('boolean');
      }
    }
  });
});
