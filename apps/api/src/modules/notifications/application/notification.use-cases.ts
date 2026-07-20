import { Inject, Injectable } from '@nestjs/common';

import { type DevicePlatform } from '../domain/device-platform';
import {
  CATEGORY_LABELS,
  isCategoryEnabled,
  type NotificationCategory,
  NOTIFICATION_CATEGORIES,
} from '../domain/notification-category';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRecord,
  type NotificationRepository,
} from '../domain/ports/notification.repository';

export interface EffectivePreference {
  category: NotificationCategory;
  label: string;
  enabled: boolean;
}

@Injectable()
export class NotificationUseCases {
  constructor(@Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository) {}

  registerDevice(input: {
    userId: string;
    token: string;
    platform: DevicePlatform;
  }): Promise<{ token: string; platform: DevicePlatform }> {
    return this.repo
      .registerToken(input)
      .then((row) => ({ token: row.token, platform: row.platform }));
  }

  unregisterDevice(userId: string, token: string): Promise<void> {
    return this.repo.deactivateOwnedToken(userId, token);
  }

  /**
   * The full preferences screen: EVERY category with its effective on/off, merging the opt-out
   * default (on unless a row says otherwise) with what the user has stored. Returning all
   * categories — not just the stored ones — is what lets the UI show the complete list.
   */
  async getPreferences(userId: string): Promise<EffectivePreference[]> {
    const stored = await this.repo.getPreferences(userId);
    return NOTIFICATION_CATEGORIES.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      enabled: isCategoryEnabled(category, stored),
    }));
  }

  setPreference(userId: string, category: NotificationCategory, enabled: boolean): Promise<void> {
    return this.repo.setPreference(userId, category, enabled);
  }

  listMyNotifications(userId: string, limit = 50): Promise<NotificationRecord[]> {
    return this.repo.listForUser(userId, Math.min(Math.max(limit, 1), 100));
  }

  /** Ops view of the dead-letter queue — everything that permanently failed to send. */
  listDeadLetters(limit = 100): Promise<NotificationRecord[]> {
    return this.repo.listDeadLetters(Math.min(Math.max(limit, 1), 500));
  }
}
