import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { WalletUseCases } from './application/wallet.use-cases';
import { WALLET_REPOSITORY } from './domain/ports/wallet.repository';
import {
  WALLET_MAINTENANCE_QUEUE,
  WalletMaintenanceScheduler,
  WalletMaintenanceWorker,
} from './infrastructure/jobs/wallet-maintenance.queue';
import { PrismaWalletRepository } from './infrastructure/persistence/prisma-wallet.repository';
import { WalletLedgerWriter } from './infrastructure/persistence/wallet-ledger.writer';
import { AdminWalletController, WalletController } from './presentation/wallet.controller';

@Module({
  // BullModule.forRoot is registered once by DeliveryModule; registerQueue attaches to it.
  imports: [BullModule.registerQueue({ name: WALLET_MAINTENANCE_QUEUE }), NotificationsModule],
  controllers: [WalletController, AdminWalletController],
  providers: [
    WalletLedgerWriter,
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    WalletUseCases,
    // Nightly: replays every wallet's ledger and alerts on a mismatch, and purges spent
    // idempotency keys. Nobody thinks to ask about the wallet that is quietly wrong, so
    // something has to ask on their behalf.
    WalletMaintenanceScheduler,
    WalletMaintenanceWorker,
  ],
  // PickupsModule credits the wallet when a pickup completes. It gets the PORT, never the
  // Prisma class — the atomic transaction lives behind this interface.
  //
  // WalletLedgerWriter is exported so the Phase 8 marketplace can debit the wallet INSIDE
  // its own order-confirmation transaction (inventory + wallet + gateway, all atomic). It is
  // the one exception to "modules see only the port": the whole point is to share the ledger
  // primitive within a caller's transaction, which a port boundary cannot express.
  exports: [WALLET_REPOSITORY, WalletLedgerWriter],
})
export class WalletModule {}
