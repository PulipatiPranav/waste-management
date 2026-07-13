import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './shared/infrastructure/cache/redis.module';
import { PrismaModule } from './shared/infrastructure/persistence/prisma/prisma.module';
import { CorrelationIdMiddleware } from './shared/presentation/middleware/correlation-id.middleware';

/**
 * Root module. Feature modules are registered here and nowhere else.
 *
 * Each feature module owns its four layers (domain / application / infrastructure /
 * presentation) and exposes only what other modules legitimately need — see
 * `modules/health` for the pattern to copy.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, HealthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*splat');
  }
}
