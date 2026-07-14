import { Module } from '@nestjs/common';

import { AddressesModule } from '@/modules/addresses/addresses.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { SubscriptionUseCases } from './application/subscription.use-cases';
import { SUBSCRIPTION_REPOSITORY } from './domain/ports/subscription.repository';
import { PrismaSubscriptionRepository } from './infrastructure/persistence/prisma-subscription.repository';
import { SubscriptionsController } from './presentation/subscriptions.controller';

@Module({
  // CatalogModule for the edition (price + delivery footprint), AddressesModule to
  // verify the delivery address belongs to this customer, AuthModule for the Clock —
  // all as ports, none as concrete classes.
  imports: [CatalogModule, AddressesModule, AuthModule],
  controllers: [SubscriptionsController],
  providers: [
    { provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository },
    SubscriptionUseCases,
  ],
})
export class SubscriptionsModule {}
