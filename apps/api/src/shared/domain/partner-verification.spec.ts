import {
  applyPartnerTransition,
  canTransitionPartner,
  InvalidPartnerTransitionError,
  isPartnerActive,
  PARTNER_STATUSES,
} from './partner-verification';

describe('partner verification lifecycle', () => {
  it('verifies a pending partner', () => {
    expect(applyPartnerTransition('PENDING', 'VERIFY')).toBe('VERIFIED');
  });

  it('suspends from pending or verified', () => {
    expect(applyPartnerTransition('PENDING', 'SUSPEND')).toBe('SUSPENDED');
    expect(applyPartnerTransition('VERIFIED', 'SUSPEND')).toBe('SUSPENDED');
  });

  it('reinstates a suspended partner back to verified', () => {
    expect(applyPartnerTransition('SUSPENDED', 'REINSTATE')).toBe('VERIFIED');
  });

  it('will not re-verify an already-verified partner (would re-stamp verifiedAt)', () => {
    expect(() => applyPartnerTransition('VERIFIED', 'VERIFY')).toThrow(
      InvalidPartnerTransitionError,
    );
  });

  it('will not reinstate something that was never suspended', () => {
    expect(canTransitionPartner('PENDING', 'REINSTATE')).toBe(false);
    expect(canTransitionPartner('VERIFIED', 'REINSTATE')).toBe(false);
  });

  it('only a VERIFIED partner may transact', () => {
    expect(isPartnerActive('VERIFIED')).toBe(true);
    expect(isPartnerActive('PENDING')).toBe(false);
    expect(isPartnerActive('SUSPENDED')).toBe(false);
  });

  it('every status/action cell is defined', () => {
    for (const status of PARTNER_STATUSES) {
      for (const action of ['VERIFY', 'SUSPEND', 'REINSTATE'] as const) {
        expect(typeof canTransitionPartner(status, action)).toBe('boolean');
      }
    }
  });
});
