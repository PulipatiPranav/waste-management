import {
  applyOrderTransition,
  canTransitionOrder,
  InvalidOrderTransitionError,
  type OrderAction,
  ORDER_STATUSES,
} from './order-state-machine';

describe('order state machine', () => {
  it('drives the happy path PENDING_PAYMENT → CONFIRMED → SHIPPED → DELIVERED', () => {
    expect(applyOrderTransition('PENDING_PAYMENT', 'CONFIRM')).toBe('CONFIRMED');
    expect(applyOrderTransition('CONFIRMED', 'SHIP')).toBe('SHIPPED');
    expect(applyOrderTransition('SHIPPED', 'DELIVER')).toBe('DELIVERED');
  });

  it('can fail or cancel only from PENDING_PAYMENT-ish states', () => {
    expect(applyOrderTransition('PENDING_PAYMENT', 'FAIL')).toBe('FAILED');
    expect(applyOrderTransition('PENDING_PAYMENT', 'CANCEL')).toBe('CANCELLED');
    expect(applyOrderTransition('CONFIRMED', 'CANCEL')).toBe('CANCELLED');
  });

  it('cannot confirm an order twice — the state-machine guard against a replay', () => {
    expect(() => applyOrderTransition('CONFIRMED', 'CONFIRM')).toThrow(InvalidOrderTransitionError);
  });

  it('cannot FAIL an order whose stock and money already moved', () => {
    expect(() => applyOrderTransition('CONFIRMED', 'FAIL')).toThrow(InvalidOrderTransitionError);
  });

  it('cannot cancel something already on a truck', () => {
    expect(canTransitionOrder('SHIPPED', 'CANCEL')).toBe(false);
    expect(canTransitionOrder('DELIVERED', 'CANCEL')).toBe(false);
  });

  it('terminal states permit nothing', () => {
    const actions: OrderAction[] = ['CONFIRM', 'FAIL', 'SHIP', 'DELIVER', 'CANCEL'];
    for (const terminal of ['DELIVERED', 'CANCELLED', 'FAILED'] as const) {
      for (const action of actions) {
        expect(canTransitionOrder(terminal, action)).toBe(false);
      }
    }
  });

  it('covers every status in the table', () => {
    const actions: OrderAction[] = ['CONFIRM', 'FAIL', 'SHIP', 'DELIVER', 'CANCEL'];
    for (const status of ORDER_STATUSES) {
      for (const action of actions) {
        // Must not throw a TypeError from a missing table cell — every cell is defined.
        expect(typeof canTransitionOrder(status, action)).toBe('boolean');
      }
    }
  });
});
