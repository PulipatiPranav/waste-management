import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';

import { isCategoryEnabled, type NotificationCategory } from '../../domain/notification-category';
import {
  type NotificationDispatcher,
  type NotificationRequest,
} from '../../domain/ports/notification-dispatcher.port';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProvider,
} from '../../domain/ports/notification-provider.port';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../../domain/ports/notification.repository';
import {
  computeBackoffMs,
  decidePushOutcome,
  NOTIFICATION_MAX_ATTEMPTS,
} from '../../domain/retry-policy';

export const NOTIFICATIONS_QUEUE = 'notifications';

interface NotificationJob {
  notificationId: string;
}

/**
 * The dispatcher every trigger calls. It does two things, both cheap, and NEITHER of which can
 * fail the request that triggered it:
 *
 *   1. Applies the user's per-category opt-out. A silenced category never becomes a job — the
 *      filter is here, once, so no individual trigger can forget it.
 *   2. Persists a QUEUED notification row and enqueues its id. The slow, flaky push happens later,
 *      on the worker, so the pickup that triggered this was already credited and returned.
 *
 * `dispatch` swallows its own errors on purpose: a customer's pickup must be credited even if Redis
 * is down and the enqueue fails. A lost notification is a bad day; a lost credit is a lawsuit.
 */
@Injectable()
export class QueueNotificationDispatcher implements NotificationDispatcher {
  private readonly logger = new Logger(QueueNotificationDispatcher.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationJob>,
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
  ) {}

  async dispatch(request: NotificationRequest): Promise<void> {
    try {
      const preferences = await this.repo.getPreferences(request.userId);
      if (!isCategoryEnabled(request.category, preferences)) {
        this.logger.debug(
          `Suppressed ${request.category} for ${request.userId} (opted out); not queued.`,
        );
        return;
      }

      const notification = await this.repo.createQueued({
        userId: request.userId,
        category: request.category,
        title: request.title,
        body: request.body,
        data: request.data ?? null,
      });

      await this.queue.add(
        request.category,
        { notificationId: notification.id },
        {
          // Idempotent enqueue: the notification id is the job id, so a double-dispatch collapses.
          jobId: notification.id,
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          // Exponential from a 5s base — mirrors computeBackoffMs (5s, 10s, 20s, 40s).
          backoff: { type: 'exponential', delay: computeBackoffMs(1) },
          removeOnComplete: { count: 200 },
          // Keep failed jobs around; the dead-letter is also on the notification row.
          removeOnFail: { count: 500 },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${request.category} for ${request.userId}; the triggering action is unaffected.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/**
 * Sends one queued notification. Loads the row, pushes to every active device the user has, and
 * turns the per-device outcomes into a verdict:
 *
 *   - SENT         -> record it and stop.
 *   - DEAD_LETTER  -> record the failure with its reason (a dead device, a misconfig) and stop —
 *                     retrying is pointless.
 *   - RETRY        -> throw, so BullMQ reschedules with backoff. When attempts are exhausted, the
 *                     `failed` handler writes the dead-letter, so a permanently-failing push is
 *                     always recorded and never silently dropped.
 *
 * Dead tokens the provider reports are deactivated on every run, even a successful one.
 */
@Processor(NOTIFICATIONS_QUEUE, { concurrency: 8 })
export class NotificationWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {
    super();
  }

  async process(job: Job<NotificationJob>): Promise<{ decision: string }> {
    const notification = await this.repo.findById(job.data.notificationId);

    // Already resolved (a replay, or the row was cleaned up): nothing to do.
    if (notification?.status !== 'QUEUED') {
      return { decision: 'SKIPPED' };
    }

    const targets = await this.repo.listActiveTargets(notification.userId);
    const outcomes = await Promise.all(
      targets.map((target) =>
        this.provider.send(target, {
          title: notification.title,
          body: notification.body,
          data: notification.data ?? undefined,
        }),
      ),
    );

    const verdict = decidePushOutcome(outcomes);
    await this.repo.deactivateTokens(verdict.deadTokens);

    const attempt = attemptNumber(job);

    if (verdict.decision === 'SENT') {
      await this.repo.markSent(notification.id, attempt);
      return { decision: 'SENT' };
    }

    if (verdict.decision === 'DEAD_LETTER') {
      await this.repo.markFailed(notification.id, attempt, verdict.reason);
      this.logger.warn(`Notification ${notification.id} dead-lettered: ${verdict.reason}`);
      return { decision: 'DEAD_LETTER' };
    }

    // RETRY: throw so BullMQ reschedules. The `failed` handler dead-letters once attempts run out.
    throw new Error(verdict.reason);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationJob>, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? NOTIFICATION_MAX_ATTEMPTS;
    // Only the FINAL failure becomes a dead-letter — earlier ones are just retries in flight.
    if (job.attemptsMade < attempts) {
      return;
    }
    try {
      await this.repo.markFailed(job.data.notificationId, job.attemptsMade, error.message);
      this.logger.error(
        `Notification ${job.data.notificationId} permanently failed after ${job.attemptsMade} attempts: ${error.message}`,
      );
    } catch (writeError) {
      this.logger.error(
        `Could not write dead-letter for ${job.data.notificationId}`,
        writeError instanceof Error ? writeError.stack : String(writeError),
      );
    }
  }
}

/** The 1-based number of THIS attempt, tolerant of BullMQ's version-dependent counter. */
function attemptNumber(job: Job): number {
  return Math.max(1, job.attemptsMade + 1);
}

/** Re-exported so triggers can reference categories without importing the domain path directly. */
export type { NotificationCategory };
