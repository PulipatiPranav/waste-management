import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RedisModule } from './shared/infrastructure/cache/redis.module';
import { PrismaModule } from './shared/infrastructure/persistence/prisma/prisma.module';
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
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*splat');
  }
}
