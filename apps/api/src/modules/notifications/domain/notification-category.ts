/**
 * The notification categories, and the ONE rule that decides whether a given category may be
 * sent to a given user. Pure, because "did we correctly suppress a category the user opted out
 * of?" is exactly the sort of thing that must be provable without a database or a push provider.
 */

export const NOTIFICATION_CATEGORIES = [
  'DELIVERY_COMPLETED',
  'PICKUP_CASHBACK',
  'WITHDRAWAL_UPDATE',
  'SUBSCRIPTION_RENEWAL',
  'ORDER_STATUS',
  'PICKUP_REMINDER',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return (
    typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value)
  );
}

/** A stored opt-out decision. Only categories the user has an opinion about appear. */
export interface CategoryPreference {
  category: NotificationCategory;
  enabled: boolean;
}

/**
 * Whether a category may be sent, given the user's stored preferences.
 *
 * Opt-OUT semantics: the ABSENCE of a preference row means enabled. A user only ever stores the
 * categories they have turned OFF, so a newly-added category is on by default and no back-fill is
 * needed. This is the single gate every dispatch passes through — put it anywhere else and one
 * trigger will forget it and spam a customer who explicitly said no.
 */
export function isCategoryEnabled(
  category: NotificationCategory,
  preferences: readonly CategoryPreference[],
): boolean {
  const stored = preferences.find((pref) => pref.category === category);
  return stored?.enabled ?? true;
}

/**
 * Human-facing labels for the preferences screen. Kept beside the categories so adding a category
 * that has no label is a compile error (the Record is exhaustive), not a blank row in the UI.
 */
export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  DELIVERY_COMPLETED: 'Delivery completed',
  PICKUP_CASHBACK: 'Pickup collected & cashback credited',
  WITHDRAWAL_UPDATE: 'Wallet withdrawal updates',
  SUBSCRIPTION_RENEWAL: 'Subscription renewal reminders',
  ORDER_STATUS: 'Marketplace order updates',
  PICKUP_REMINDER: 'Pickup reminders',
};
