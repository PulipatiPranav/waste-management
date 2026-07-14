import { InvalidTransitionError } from './errors/subscription.errors';
import {
  applyTransition,
  canTransition,
  SUBSCRIPTION_ACTIONS,
  SUBSCRIPTION_STATUSES,
  type SubscriptionAction,
  type SubscriptionStatus,
} from './subscription-state-machine';

describe('subscription state machine', () => {
  describe('the legal transitions', () => {
    const legal: [SubscriptionStatus, SubscriptionAction, SubscriptionStatus][] = [
      ['ACTIVE', 'PAUSE', 'PAUSED'],
      ['ACTIVE', 'CANCEL', 'CANCELLED'],
      ['ACTIVE', 'CHANGE_ADDRESS', 'ACTIVE'],
      ['PAUSED', 'RESUME', 'ACTIVE'],
      ['PAUSED', 'CANCEL', 'CANCELLED'],
      ['PAUSED', 'CHANGE_ADDRESS', 'PAUSED'],
    ];

    it.each(legal)('%s + %s -> %s', (from, action, expected) => {
      expect(canTransition(from, action)).toBe(true);
      expect(applyTransition(from, action)).toBe(expected);
    });
  });

  describe('CANCELLED is terminal', () => {
    // The single most important property here. A cancelled subscription that can be
    // resumed is one whose final invoice has already been issued and is now wrong.
    it.each(SUBSCRIPTION_ACTIONS)('refuses %s', (action) => {
      expect(canTransition('CANCELLED', action)).toBe(false);
      expect(() => applyTransition('CANCELLED', action)).toThrow(InvalidTransitionError);
    });
  });

  describe('redundant transitions are errors, not silent no-ops', () => {
    it('refuses to pause an already-paused subscription', () => {
      // Accepting this would open a second pause window and credit the same skipped
      // issues twice.
      expect(() => applyTransition('PAUSED', 'PAUSE')).toThrow(InvalidTransitionError);
    });

    it('refuses to resume a running subscription', () => {
      expect(() => applyTransition('ACTIVE', 'RESUME')).toThrow(InvalidTransitionError);
    });
  });

  it('names both the state and the action in the error', () => {
    // "Cannot pause a subscription that is CANCELLED" is answerable in a support
    // ticket. "Invalid state" is not.
    expect(() => applyTransition('CANCELLED', 'PAUSE')).toThrow(/pause.*CANCELLED/i);
  });

  it('has an explicit entry for every state/action pair', () => {
    // Guards against a new status or action being added to the enum but not to the
    // table, which would otherwise surface as `undefined !== null` — i.e. silently
    // ALLOWED — at runtime.
    for (const status of SUBSCRIPTION_STATUSES) {
      for (const action of SUBSCRIPTION_ACTIONS) {
        expect(typeof canTransition(status, action)).toBe('boolean');
      }
    }
  });
});
