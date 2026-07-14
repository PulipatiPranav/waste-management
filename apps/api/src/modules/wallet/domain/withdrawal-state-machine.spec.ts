import {
  applyWithdrawalTransition,
  canTransition,
  InvalidWithdrawalTransitionError,
  WITHDRAWAL_ACTIONS,
  WITHDRAWAL_STATUSES,
} from './withdrawal-state-machine';

describe('withdrawal state machine', () => {
  it('follows the approval path: REQUESTED -> APPROVED -> PAID', () => {
    expect(applyWithdrawalTransition('REQUESTED', 'APPROVE')).toBe('APPROVED');
    expect(applyWithdrawalTransition('APPROVED', 'MARK_PAID')).toBe('PAID');
  });

  it('follows the rejection path', () => {
    expect(applyWithdrawalTransition('REQUESTED', 'REJECT')).toBe('REJECTED');
  });

  it('cannot skip approval and go straight to PAID', () => {
    // The manual approval step IS the control. A path around it makes the control
    // decorative — and payout automation is a compliance decision (RBI PPI), not an
    // engineering one.
    expect(() => applyWithdrawalTransition('REQUESTED', 'MARK_PAID')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it('cannot reject a withdrawal that has already been approved', () => {
    // Once ops approves, money may already be in flight at the bank. Reversing it in the
    // system while it lands in the customer's account would double-pay. A mistake here is
    // corrected with a visible ADJUSTMENT entry, not by rewriting the request.
    expect(() => applyWithdrawalTransition('APPROVED', 'REJECT')).toThrow(
      InvalidWithdrawalTransitionError,
    );
  });

  it.each(WITHDRAWAL_ACTIONS)('PAID is terminal: refuses %s', (action) => {
    expect(canTransition('PAID', action)).toBe(false);
  });

  it.each(WITHDRAWAL_ACTIONS)('REJECTED is terminal: refuses %s', (action) => {
    expect(canTransition('REJECTED', action)).toBe(false);
  });

  it('has an explicit entry for every state/action pair', () => {
    for (const status of WITHDRAWAL_STATUSES) {
      for (const action of WITHDRAWAL_ACTIONS) {
        expect(typeof canTransition(status, action)).toBe('boolean');
      }
    }
  });
});
