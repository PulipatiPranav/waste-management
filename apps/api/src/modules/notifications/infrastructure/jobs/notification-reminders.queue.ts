import { InjectQueue, Processor } from '@nestjs/bullmq';
import { TracedWorkerHost } from '@/observability/tracing/traced-worker-host';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue } from 'bullmq';

import { type Env } from '@/config/env.schema';
import {
  NOTIFICATION_DISPATCHER,
  type NotificationDispatcher,
} from '../../domain/ports/notification-dispatcher.port';
import { REMINDER_QUERY, type ReminderQuery } from '../../domain/ports/reminder-query.port';
import { isRenewalReminderDue } from '../../domain/renewal-schedule';

export const REMINDERS_QUEUE = 'notification-reminders';

const RENEWAL_JOB = 'renewal-reminders';
const PICKUP_JOB = 'pickup-reminders';

/**
 * Registers the two daily reminder scans as repeatable jobs. Unlike the send queue (which is
 * driven by triggers), these are time-based sweeps: once a day they look for subscriptions about
 * to renew and pickups happening tomorrow, and dispatch a reminder for each. Dispatch goes through
 * the same preference filter and queue as every other notification.
 */
@Injectable()
export class ReminderScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('NOTIFICATIONS_ENABLED', { infer: true })) {
      this.logger.warn('Notifications DISABLED: reminder scans will not run in this process.');
      return;
    }

    // Clear old repeatables so a changed cron does not leave the previous schedule firing too.
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    const renewalCron = this.config.get('NOTIFICATION_RENEWAL_REMINDER_CRON', { infer: true });
    const pickupCron = this.config.get('NOTIFICATION_PICKUP_REMINDER_CRON', { infer: true });

    await this.queue.add(
      RENEWAL_JOB,
      {},
      {
        repeat: { pattern: renewalCron },
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    );
    await this.queue.add(
      PICKUP_JOB,
      {},
      {
        repeat: { pattern: pickupCron },
        removeOnComplete: { count: 14 },
        removeOnFail: { count: 30 },
      },
    );

    this.logger.log(`Reminders scheduled — renewal: ${renewalCron}, pickup: ${pickupCron}`);
  }
}

@Processor(REMINDERS_QUEUE, { concurrency: 1 })
export class ReminderWorker extends TracedWorkerHost {
  private readonly logger = new Logger(ReminderWorker.name);

  constructor(
    @Inject(REMINDER_QUERY) private readonly reminders: ReminderQuery,
    @Inject(NOTIFICATION_DISPATCHER) private readonly dispatcher: NotificationDispatcher,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async processJob(job: Job): Promise<{ dispatched: number }> {
    if (job.name === RENEWAL_JOB) return this.renewalReminders();
    if (job.name === PICKUP_JOB) return this.pickupReminders();
    return { dispatched: 0 };
  }

  /** Dispatch to every ACTIVE subscription whose renewal is exactly the lead days away. */
  private async renewalReminders(): Promise<{ dispatched: number }> {
    const leadDays = this.config.get('RENEWAL_REMINDER_LEAD_DAYS', { infer: true });
    const today = new Date();
    const subscriptions = await this.reminders.activeSubscriptions();

    let dispatched = 0;
    for (const sub of subscriptions) {
      if (!isRenewalReminderDue(sub.startDate, sub.billingCycle, today, leadDays)) continue;
      await this.dispatcher.dispatch({
        userId: sub.userId,
        category: 'SUBSCRIPTION_RENEWAL',
        title: 'Subscription renewing soon',
        body: `Your ${sub.editionName} subscription renews in ${leadDays} day${leadDays === 1 ? '' : 's'}.`,
        data: { type: 'subscription_renewal' },
      });
      dispatched += 1;
    }

    this.logger.log(`Renewal reminders dispatched: ${dispatched}`);
    return { dispatched };
  }

  /** Dispatch to everyone with a pickup scheduled for TOMORROW that is still upcoming. */
  private async pickupReminders(): Promise<{ dispatched: number }> {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    const pickups = await this.reminders.pendingPickupsOn(tomorrow);

    let dispatched = 0;
    for (const pickup of pickups) {
      await this.dispatcher.dispatch({
        userId: pickup.userId,
        category: 'PICKUP_REMINDER',
        title: 'Paper pickup tomorrow',
        body: 'Keep your recyclable paper ready — a pickup is scheduled for tomorrow.',
        data: { type: 'pickup_reminder' },
      });
      dispatched += 1;
    }

    this.logger.log(`Pickup reminders dispatched: ${dispatched}`);
    return { dispatched };
  }
}
