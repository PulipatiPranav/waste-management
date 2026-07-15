import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from './config/config.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HealthModule } from './modules/health/health.module';
import { ImpactModule } from './modules/impact/impact.module';
import { PickupsModule } from './modules/pickups/pickups.module';
import { RecyclingModule } from './modules/recycling/recycling.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { RedisModule } from './shared/infrastructure/cache/redis.module';
import { PrismaModule } from './shared/infrastructure/persistence/prisma/prisma.module';
import { IdempotencyInterceptor } from './shared/presentation/interceptors/idempotency.interceptor';
import { CorrelationIdMiddleware } from './shared/presentation/middleware/correlation-id.middleware';

/**
 * Root module. Feature modules are registered here and nowhere else.
 *
 * AuthModule registers the global JwtAuthGuard, so importing it makes every endpoint
 * in the application authenticated by default. Opting out is `@Public()`, which is
 * greppable — unlike the opposite arrangement, where a forgotten guard ships an open
 * endpoint and nothing tells you.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    CatalogModule,
    SubscriptionsModule,
    DeliveryModule,
    WalletModule,
    PickupsModule,
    RecyclingModule,
    ImpactModule,
    HealthModule,
  ],
  providers: [
    // Registered GLOBALLY, but it only acts on handlers marked @Idempotent(). Global
    // registration means a new money-moving endpoint gets replay protection by adding one
    // decorator, rather than by remembering to wire an interceptor — and a forgotten
    // interceptor on a wallet-credit endpoint is a double payment.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*splat');
  }
}
