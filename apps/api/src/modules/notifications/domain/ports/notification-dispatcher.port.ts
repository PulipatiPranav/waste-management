import { type NotificationCategory } from '../notification-category';

export interface NotificationRequest {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Optional structured payload (deep link, entity id) the app acts on. String map only. */
  data?: Record<string, string>;
}

/**
 * The seam every trigger uses. A module that wants to notify a user (a completed pickup, an
 * approved withdrawal) depends on THIS interface — not on BullMQ, not on a push provider — and
 * calls `dispatch`. The implementation applies the user's preferences and enqueues the send, so
 * the triggering request returns immediately whether or not FCM is reachable that second.
 *
 * `dispatch` never throws for a delivery problem: notifying a customer must never be able to fail
 * the money-moving action that triggered it. A pickup is credited even if the push queue is down.
 */
export interface NotificationDispatcher {
  dispatch(request: NotificationRequest): Promise<void>;
}

export const NOTIFICATION_DISPATCHER = Symbol('NOTIFICATION_DISPATCHER');
