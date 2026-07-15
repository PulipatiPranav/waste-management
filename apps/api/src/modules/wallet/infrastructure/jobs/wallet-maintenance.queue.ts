import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';

import { type Env } from '@/config/env.schema';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { reconcile } from '../../domain/ledger';

export const WALLET_MAINTENANCE_QUEUE = 'wallet-maintenance';

type MaintenanceJob = 'reconcile-all' | 'purge-idempotency-keys';

@Injectable()
export class WalletMaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WalletMaintenanceScheduler.name);

  constructor(
    @InjectQueue(WALLET_MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('WALLET_MAINTENANCE_ENABLED', { infer: true })) {
      this.logger.warn(
        'Wallet maintenance is DISABLED. Nothing will verify that wallet balances still match their ledgers.',
      );
      return;
    }

    // Clear old schedules first: BullMQ keys a repeatable by its cron, so changing the
    // expression leaves the previous one firing forever alongside the new one.
    for (const existing of await this.queue.getRepeatableJobs()) {
      await this.queue.removeRepeatableByKey(existing.key);
    }

    const reconcileCron = this.config.get('WALLET_RECONCILE_CRON', { infer: true });

    await this.queue.add(
      'reconcile-all' satisfies MaintenanceJob,
      {},
      {
        repeat: { pattern: reconcileCron },
        attempts: 2,
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 50 },
      },
    );

    await this.queue.add(
      'purge-idempotency-keys' satisfies MaintenanceJob,
      {},
      {
        repeat: { pattern: '30 3 * * *' },
        attempts: 2,
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 20 },
      },
    );

    this.logger.log(`Wallet reconciliation scheduled: ${reconcileCron}`);
  }
}

@Processor(WALLET_MAINTENANCE_QUEUE, { concurrency: 1 })
export class WalletMaintenanceWorker extends WorkerHost {
  private readonly logger = new Logger(WalletMaintenanceWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name as MaintenanceJob) {
      case 'reconcile-all':
        return this.reconcileAll();
      case 'purge-idempotency-keys':
        return this.purgeIdempotencyKeys();
      default:
        throw new Error(`Unknown wallet maintenance job: ${job.name}`);
    }
  }

  /**
   * Replays EVERY wallet's ledger and checks it against the cached balance.
   *
   * The on-demand `/reconcile` endpoint answers "is this one customer's balance right?".
   * This answers "is anybody's balance wrong?" — which is the question that actually
   * matters, because nobody thinks to ask about the wallet that is quietly broken.
   *
   * A mismatch means a write escaped the row lock and the cached balance is a lie. It is
   * logged at ERROR with the wallet id, which is what an alerting rule should page on. It
   * does NOT auto-correct: silently rewriting a balance to match a ledger you have not
   * understood is how a bug becomes a cover-up.
   */
  private async reconcileAll(): Promise<{ checked: number; mismatched: number }> {
    const wallets = await this.prisma.wallet.findMany({
      select: { id: true, userId: true, balancePaise: true },
    });

    let mismatched = 0;

    for (const wallet of wallets) {
      const entries = await this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        // `seq`, not `createdAt`. A transaction that starts earlier can commit later
        // (it waits on the wallet lock), so timestamp order is not ledger order.
        orderBy: { seq: 'asc' },
        select: { direction: true, amountPaise: true, balanceAfterPaise: true },
      });

      const result = reconcile(entries, wallet.balancePaise);

      if (!result.ok) {
        mismatched += 1;

        this.logger.error(
          `LEDGER MISMATCH — wallet ${wallet.id} (user ${wallet.userId}): ` +
            `cached balance ${wallet.balancePaise} paise, ledger replays to ` +
            `${result.computedBalancePaise} paise over ${entries.length} entries` +
            (result.brokenAtIndex === null
              ? ' (the chain is internally consistent, so the CACHE is wrong)'
              : ` (chain first breaks at entry ${result.brokenAtIndex})`) +
            '. A write escaped the wallet row lock. Do NOT auto-correct: investigate.',
        );
      }
    }

    if (mismatched === 0) {
      this.logger.log(`Reconciled ${wallets.length} wallet(s): all balances match their ledgers.`);
    } else {
      this.logger.error(`${mismatched} of ${wallets.length} wallet(s) FAILED reconciliation.`);
    }

    return { checked: wallets.length, mismatched };
  }

  /**
   * Deletes idempotency keys older than the retention window.
   *
   * The table is written to on every money-moving request and never read again after the
   * client stops retrying. Without this it grows without bound — and the unique index on
   * (userId, key, endpoint) grows with it, so the cost lands on the write path of the very
   * endpoints that must stay fast.
   *
   * The window has to comfortably exceed how long any client will keep retrying. A day is
   * generous: a delivery partner's phone gives up long before that.
   */
  private async purgeIdempotencyKeys(): Promise<{ deleted: number }> {
    const hours = this.config.get('IDEMPOTENCY_RETENTION_HOURS', { infer: true });
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const result = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    this.logger.log(
      `Purged ${result.count} idempotency key(s) older than ${hours}h. ` +
        'They are replay protection, not an audit trail — the ledger is the audit trail.',
    );

    return { deleted: result.count };
  }
}
