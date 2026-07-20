import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { AuthModule } from '@/modules/auth/auth.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { MarketplaceUseCases } from './application/marketplace.use-cases';
import { MARKETPLACE_REPOSITORY } from './domain/ports/marketplace.repository';
import { PAYMENT_GATEWAY, type PaymentGateway } from './domain/ports/payment-gateway';
import { FakePaymentGateway } from './infrastructure/gateway/fake-payment.gateway';
import { RazorpayPaymentGateway } from './infrastructure/gateway/razorpay-payment.gateway';
import { PrismaMarketplaceRepository } from './infrastructure/persistence/prisma-marketplace.repository';
import { AdminMarketplaceController } from './presentation/admin-marketplace.controller';
import { MarketplaceController } from './presentation/marketplace.controller';
import { PaymentWebhookController } from './presentation/payment-webhook.controller';

@Module({
  // WalletModule exports WalletLedgerWriter so order confirmation can debit the wallet inside
  // its own transaction — the one place the marketplace reaches into the money core, and it
  // does so through the shared ledger primitive rather than reimplementing a debit.
  imports: [AuthModule, WalletModule, NotificationsModule],
  controllers: [MarketplaceController, AdminMarketplaceController, PaymentWebhookController],
  providers: [
    { provide: MARKETPLACE_REPOSITORY, useClass: PrismaMarketplaceRepository },
    MarketplaceUseCases,
    // The gateway is chosen at boot from config: the real Razorpay adapter, or the in-process
    // fake for dev/tests. Business logic only ever sees the PAYMENT_GATEWAY token, so this is
    // the ONE place the concrete provider is named.
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway =>
        config.get('PAYMENT_GATEWAY_PROVIDER', { infer: true }) === 'razorpay'
          ? new RazorpayPaymentGateway(config)
          : new FakePaymentGateway(config),
    },
  ],
})
export class MarketplaceModule {}
