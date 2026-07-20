import { Injectable, Logger } from '@nestjs/common';

import {
  type NotificationProvider,
  type PushMessage,
  type PushOutcome,
  type PushTarget,
} from '../../domain/ports/notification-provider.port';

/**
 * An in-process push provider for local development and tests. It never touches a network; it
 * records every send so a test can assert what would have gone out, and it derives the outcome
 * from the TOKEN itself so the retry/backoff and dead-letter paths can be exercised deterministically
 * without patching anything:
 *
 *   - a token starting with `dead-`     -> permanent failure (a dead device; deactivate, no retry)
 *   - a token starting with `flaky-`    -> transient failure (a blip; the queue should retry)
 *   - anything else                     -> success
 *
 * REFUSED in production by the env schema — a notification that "sends" into a log is not a
 * notification.
 */
@Injectable()
export class FakePushProvider implements NotificationProvider {
  readonly name = 'fake';
  private readonly logger = new Logger(FakePushProvider.name);

  /** Every send attempt, in order — for test assertions. */
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ target, message });
    this.logger.debug(`[fake push] ${target.platform} ${target.token}: ${message.title}`);

    if (target.token.startsWith('dead-')) {
      return Promise.resolve({
        token: target.token,
        ok: false,
        permanent: true,
        error: 'fake: token is not registered',
      });
    }
    if (target.token.startsWith('flaky-')) {
      return Promise.resolve({
        token: target.token,
        ok: false,
        permanent: false,
        error: 'fake: transient provider error',
      });
    }
    return Promise.resolve({ token: target.token, ok: true, permanent: false });
  }
}
