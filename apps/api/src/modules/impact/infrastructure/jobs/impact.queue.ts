import { InjectQueue, Processor } from '@nestjs/bullmq';
import { TracedWorkerHost } from '@/observability/tracing/traced-worker-host';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { type Env } from '@/config/env.schema';
import { ImpactUseCases } from '../../application/impact.use-cases';

export const IMPACT_QUEUE = 'impact-aggregation';

@Injectable()
export class ImpactScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImpactScheduler.name);

  constructor(
    @InjectQueue(IMPACT_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('IMPACT_AGGREGATION_ENABLED', { infer: true })) {
      this.logger.warn(
        'Impact aggregation is DISABLED. Sustainability dashboards will not refresh.',
      );
      return;
    }

    // Clear old schedules: BullMQ keys a repeatable by its cron, so a changed expression
    // otherwise leaves the previous one firing alongside the new one.
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    const cron = this.config.get('IMPACT_AGGREGATION_CRON', { infer: true });

    await this.queue.add(
      'recompute-impact',
      {},
      {
        repeat: { pattern: cron },
        attempts: 2,
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(`Impact aggregation scheduled: ${cron}`);
  }
}

/**
 * Recomputes the impact cache nightly.
 *
 * Runs AFTER the batching job (05:00 vs 04:00 by default), so it sees the day's freshly
 * confirmed batches. The recompute is a full replace-all of the cache, so it is idempotent —
 * a retry or a manual kick produces the same result, and there is no partial state a
 * dashboard could read mid-run (the swap is one transaction).
 */
@Processor(IMPACT_QUEUE, { concurrency: 1 })
export class ImpactWorker extends TracedWorkerHost {
  private readonly logger = new Logger(ImpactWorker.name);

  constructor(private readonly impact: ImpactUseCases) {
    super();
  }

  async processJob(): Promise<{ rows: number }> {
    this.logger.log('Recomputing sustainability impact cache from confirmed recycling.');
    return this.impact.refreshCache();
  }
}
