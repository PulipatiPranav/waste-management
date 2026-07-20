import { Logger } from '@nestjs/common';

import {
  type NotificationProvider,
  type PushMessage,
  type PushOutcome,
  type PushTarget,
} from '../../domain/ports/notification-provider.port';
import { type ApnsProvider } from './apns.provider';
import { type FcmProvider } from './fcm.provider';

/**
 * The unified `NotificationProvider` the queue talks to. It routes each send by platform — Android
 * to FCM, iOS to APNs — so the worker never has to know which backend a device lives on. This is
 * the "unified behind a NotificationProvider interface" the brief asks for: two vendor integrations,
 * one seam.
 *
 * A platform with no configured backend fails PERMANENTLY rather than transiently — retrying a
 * device we have no way to reach just churns the queue. That is a configuration error, surfaced as
 * a dead-letter with a clear reason, not an infinite retry.
 */
export class CompositePushProvider implements NotificationProvider {
  readonly name = 'composite';
  private readonly logger = new Logger(CompositePushProvider.name);

  constructor(
    private readonly fcm: FcmProvider | null,
    private readonly apns: ApnsProvider | null,
  ) {}

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (target.platform === 'ANDROID') {
      if (this.fcm === null) return this.misconfigured(target, 'FCM');
      return this.fcm.send(target, message);
    }
    if (this.apns === null) return this.misconfigured(target, 'APNs');
    return this.apns.send(target, message);
  }

  private misconfigured(target: PushTarget, backend: string): Promise<PushOutcome> {
    this.logger.error(`No ${backend} backend configured; cannot push to ${target.platform}.`);
    return Promise.resolve({
      token: target.token,
      ok: false,
      permanent: true,
      error: `${backend} is not configured`,
    });
  }
}
