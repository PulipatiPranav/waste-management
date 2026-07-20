import {
  CATEGORY_LABELS,
  type CategoryPreference,
  isCategoryEnabled,
  isNotificationCategory,
  NOTIFICATION_CATEGORIES,
} from './notification-category';

describe('isCategoryEnabled — opt-out preference filtering', () => {
  it('is enabled by default when the user has no stored preference', () => {
    expect(isCategoryEnabled('PICKUP_CASHBACK', [])).toBe(true);
  });

  it('is disabled when the user has explicitly opted out of that category', () => {
    const prefs: CategoryPreference[] = [{ category: 'SUBSCRIPTION_RENEWAL', enabled: false }];
    expect(isCategoryEnabled('SUBSCRIPTION_RENEWAL', prefs)).toBe(false);
  });

  it('opting out of one category leaves the others enabled (not all-or-nothing)', () => {
    const prefs: CategoryPreference[] = [{ category: 'SUBSCRIPTION_RENEWAL', enabled: false }];
    expect(isCategoryEnabled('PICKUP_CASHBACK', prefs)).toBe(true);
    expect(isCategoryEnabled('WITHDRAWAL_UPDATE', prefs)).toBe(true);
  });

  it('respects an explicit re-enable', () => {
    const prefs: CategoryPreference[] = [{ category: 'ORDER_STATUS', enabled: true }];
    expect(isCategoryEnabled('ORDER_STATUS', prefs)).toBe(true);
  });
});

describe('category metadata', () => {
  it('isNotificationCategory guards unknown strings', () => {
    expect(isNotificationCategory('PICKUP_CASHBACK')).toBe(true);
    expect(isNotificationCategory('NONSENSE')).toBe(false);
    expect(isNotificationCategory(42)).toBe(false);
  });

  it('every category has a human label', () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});
