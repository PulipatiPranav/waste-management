import { Module } from '@nestjs/common';

import { WalletUseCases } from './application/wallet.use-cases';
import { WALLET_REPOSITORY } from './domain/ports/wallet.repository';
import { PrismaWalletRepository } from './infrastructure/persistence/prisma-wallet.repository';
import { AdminWalletController, WalletController } from './presentation/wallet.controller';

@Module({
  controllers: [WalletController, AdminWalletController],
  providers: [{ provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository }, WalletUseCases],
  // PickupsModule credits the wallet when a pickup completes. It gets the PORT, never the
  // Prisma class — the atomic transaction lives behind this interface.
  exports: [WALLET_REPOSITORY],
})
export class WalletModule {}
