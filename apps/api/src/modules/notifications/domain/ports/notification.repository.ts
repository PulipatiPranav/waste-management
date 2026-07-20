import { type DevicePlatform } from '../device-platform';
import { type CategoryPreference, type NotificationCategory } from '../notification-category';

export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  isActive: boolean;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  data: Record<string, string> | null;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface NotificationRepository {
  // --- Device tokens --------------------------------------------------------

  /** Upserts on the token (a device install is one row) and (re)activates it, moving owner if handed on. */
  registerToken(input: {
    userId: string;
    token: string;
    platform: DevicePlatform;
  }): Promise<DeviceTokenRecord>;

  /** Owner-scoped unregister (a user signing out of one device). */
  deactivateOwnedToken(userId: string, token: string): Promise<void>;

  /** Marks tokens dead after a provider says so. Not owner-scoped — the provider is authoritative. */
  deactivateTokens(tokens: readonly string[]): Promise<void>;

  listActiveTargets(userId: string): Promise<{ token: string; platform: DevicePlatform }[]>;

  // --- Preferences ----------------------------------------------------------

  getPreferences(userId: string): Promise<CategoryPreference[]>;
  setPreference(userId: string, category: NotificationCategory, enabled: boolean): Promise<void>;

  // --- Notification log / dead-letter --------------------------------------

  createQueued(input: {
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    data: Record<string, string> | null;
  }): Promise<NotificationRecord>;

  markSent(id: string, attempts: number): Promise<void>;

  /** THE dead-letter write: a permanently-failed push, kept with its error, never dropped. */
  markFailed(id: string, attempts: number, error: string): Promise<void>;

  findById(id: string): Promise<NotificationRecord | null>;
  listForUser(userId: string, limit: number): Promise<NotificationRecord[]>;

  /** For ops: everything that permanently failed to send. */
  listDeadLetters(limit: number): Promise<NotificationRecord[]>;
}

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');
