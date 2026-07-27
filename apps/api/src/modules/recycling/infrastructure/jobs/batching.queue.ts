import { InjectQueue, Processor } from '@nestjs/bullmq';
import { TracedWorkerHost } from '@/observability/tracing/traced-worker-host';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { type Env } from '@/config/env.schema';
import { RecyclingUseCases } from '../../application/recycling.use-cases';

export const BATCHING_QUEUE = 'recycling-batching';

@Injectable()
export class BatchingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(BatchingScheduler.name);

  constructor(
    @InjectQueue(BATCHING_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('BATCHING_ENABLED', { infer: true })) {
      this.logger.warn(
        'Batching is DISABLED. Collected paper will accumulate unbatched and never reach a mill.',
      );
      return;
    }

    // Clear old schedules: BullMQ keys a repeatable by its cron, so changing the expression
    // otherwise leaves the previous one firing forever alongside the new one.
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    const cron = this.config.get('BATCHING_CRON', { infer: true });

    await this.queue.add(
      'batch-completed-pickups',
      {},
      {
        repeat: { pattern: cron },
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(`Batching scheduled: ${cron}`);
  }
}

/**
 * Sweeps completed pickups into collection batches.
 *
 * Runs AFTER the delivery/pickup work of the day is done (04:00 by default), so it batches
 * a settled set of pickups rather than a moving one. Idempotent — it only looks at items
 * with no batch, and claims them with a conditional update — so a retry, a manual kick, or
 * two workers racing cannot put one item into two batches. An item in two batches is tonnage
 * counted twice, which is the fastest possible way to lose an ESG audit.
 */
@Processor(BATCHING_QUEUE, { concurrency: 1 })
export class BatchingWorker extends TracedWorkerHost {
  private readonly logger = new Logger(BatchingWorker.name);

  constructor(private readonly recycling: RecyclingUseCases) {
    super();
  }

  async processJob(): Promise<{ itemsBatched: number; readyToDispatch: number }> {
    const result = await this.recycling.runBatching();

    if (result.batchesReadyToDispatch > 0) {
      this.logger.log(
        `${result.batchesReadyToDispatch} batch(es) are at or above the dispatch minimum and ` +
          'are waiting for ops to close and dispatch them.',
      );
    }

    return {
      itemsBatched: result.itemsBatched,
      readyToDispatch: result.batchesReadyToDispatch,
    };
  }
}
