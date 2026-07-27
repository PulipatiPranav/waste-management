import { WorkerHost } from '@nestjs/bullmq';
import { type Job } from 'bullmq';

import { withJobSpan } from './job-span';

/**
 * A `WorkerHost` whose job processing is traced. Every BullMQ worker in the app extends this instead
 * of `WorkerHost` and implements `processJob` instead of `process`; the span (name, timing, error
 * status) is applied in one place rather than copied into six processors.
 *
 * When OpenTelemetry is off the span is a no-op, so this is free in dev and tests.
 */
export abstract class TracedWorkerHost<T = unknown, R = unknown> extends WorkerHost {
  /** The actual job logic. Subclasses implement this; `process` wraps it in a span. */
  abstract processJob(job: Job<T>): Promise<R>;

  async process(job: Job<T>): Promise<R> {
    return withJobSpan(job.queueName, job.name, job.id, () => this.processJob(job));
  }
}
