import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';

import { type Env } from '@/config/env.schema';
import { AssignPickupsToRunsUseCase } from '@/modules/pickups/application/assign-pickups.use-case';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { PlanDeliveryRunsUseCase } from '../../application/delivery.use-cases';

export const DELIVERY_PLANNER_QUEUE = 'delivery-planner';

/** `runDate` is optional: the nightly schedule omits it and plans tomorrow. */
interface PlanJobData {
  runDate?: string;
}

/**
 * Registers the nightly repeatable job.
 *
 * The repeatable job is registered on bootstrap rather than declared once by hand,
 * because BullMQ keys a repeatable by its cron + name: changing DELIVERY_PLANNER_CRON
 * leaves the OLD schedule in Redis forever unless it is explicitly removed. Without the
 * cleanup below, editing the cron gives you a planner that runs at BOTH times.
 */
@Injectable()
export class DeliveryPlannerScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeliveryPlannerScheduler.name);

  constructor(
    @InjectQueue(DELIVERY_PLANNER_QUEUE) private readonly queue: Queue<PlanJobData>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('DELIVERY_PLANNER_ENABLED', { infer: true })) {
      this.logger.warn('Delivery planner is DISABLED. No run sheets will be generated.');
      return;
    }

    const cron = this.config.get('DELIVERY_PLANNER_CRON', { infer: true });

    // Drop every existing schedule first. Otherwise a cron change accumulates: the old
    // 21:00 job keeps firing alongside the new 22:00 one, and both plan the same night.
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    await this.queue.add(
      'plan-tomorrow',
      {},
      {
        repeat: { pattern: cron },
        // Retry a transient DB blip. If it still fails after this, the run sheets do
        // not exist and ops must be told — the error log from the use case is the alarm.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 100 },
      },
    );

    this.logger.log(`Delivery planner scheduled: ${cron}`);
  }
}

@Processor(DELIVERY_PLANNER_QUEUE, {
  // One planner at a time. Two workers planning the same night would race on the
  // run's unique index — survivable (the index holds) but pointless churn, and the
  // "created vs skipped" numbers in the log would become nonsense.
  concurrency: 1,
})
export class DeliveryPlannerWorker extends WorkerHost {
  private readonly logger = new Logger(DeliveryPlannerWorker.name);

  constructor(
    private readonly planner: PlanDeliveryRunsUseCase,
    private readonly pickupAssigner: AssignPickupsToRunsUseCase,
  ) {
    super();
  }

  async process(
    job: Job<PlanJobData>,
  ): Promise<{ created: number; unassigned: number; pickupsAssigned: number }> {
    const runDate = job.data.runDate === undefined ? undefined : Day.parse(job.data.runDate);

    this.logger.log(`Planning delivery runs (job ${job.id})`);

    const plan = await this.planner.execute(runDate);

    // Pickups are slotted in AFTER the runs exist, in the same job — a pickup rides along
    // with the delivery round rather than getting its own dispatch. The partner is already
    // walking that street with the morning papers; sending a second person to collect the
    // old ones would double the cost of the entire circular model.
    const pickups = await this.pickupAssigner.execute(plan.runDate);

    return {
      created: plan.created,
      unassigned: plan.unassigned.length,
      pickupsAssigned: pickups.assigned,
    };
  }
}
