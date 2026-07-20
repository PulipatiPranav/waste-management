import { type DevicePlatform } from '../device-platform';

export interface PushMessage {
  title: string;
  body: string;
  /** String map only — FCM/APNs custom data is string-keyed strings; anything else is coerced. */
  data?: Record<string, string>;
}

export interface PushTarget {
  token: string;
  platform: DevicePlatform;
}

/**
 * The result of trying to push to ONE device. `permanent` is the load-bearing field: a permanent
 * failure means the token is dead (the app was uninstalled, the token expired) and must never be
 * retried — retrying it forever is how a queue backs up on garbage. A non-permanent failure
 * (network blip, provider 5xx, throttle) is worth a retry.
 */
export interface PushOutcome {
  token: string;
  ok: boolean;
  permanent: boolean;
  error?: string;
}

/**
 * The unified push interface. FCM (Android) and APNs (iOS) are two adapters behind this one
 * interface; the queue worker never knows which one it is talking to. The concrete provider is
 * chosen per-platform by a composite adapter, and a fake stands in for dev and tests — the same
 * pattern as the SMS and payment-gateway boundaries elsewhere in this codebase.
 */
export interface NotificationProvider {
  readonly name: string;
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
