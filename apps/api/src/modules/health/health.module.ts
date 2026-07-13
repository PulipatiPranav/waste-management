import { Module } from '@nestjs/common';

import { CheckReadinessUseCase } from './application/use-cases/check-readiness.use-case';
import { HEALTH_PROBES, type HealthProbe } from './domain/ports/health-probe.port';
import { PostgresProbe } from './infrastructure/probes/postgres.probe';
import { RedisProbe } from './infrastructure/probes/redis.probe';
import { HealthController } from './presentation/health.controller';

/**
 * The composition root for this module — the only file that knows both the
 * abstraction and its implementations.
 *
 * Nest has no multi-provider concept, so the concrete probes are collected into an
 * array bound to `HEALTH_PROBES`. Registering a new dependency to watch means
 * adding its class here and nowhere else; `CheckReadinessUseCase` never changes,
 * which is the open/closed principle doing actual work rather than decorating a
 * diagram.
 */
@Module({
  controllers: [HealthController],
  providers: [
    PostgresProbe,
    RedisProbe,
    {
      provide: HEALTH_PROBES,
      useFactory: (...probes: HealthProbe[]): HealthProbe[] => probes,
      inject: [PostgresProbe, RedisProbe],
    },
    CheckReadinessUseCase,
  ],
})
export class HealthModule {}
