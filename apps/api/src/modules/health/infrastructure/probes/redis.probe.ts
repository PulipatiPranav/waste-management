import { Injectable } from '@nestjs/common';

import { RedisService } from '@/shared/infrastructure/cache/redis.service';
import { type HealthProbe, type ProbeResult } from '../../domain/ports/health-probe.port';

@Injectable()
export class RedisProbe implements HealthProbe {
  readonly name = 'redis';

  constructor(private readonly redis: RedisService) {}

  async check(): Promise<ProbeResult> {
    const startedAt = Date.now();

    try {
      await this.redis.ping();
      return { name: this.name, status: 'up', durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
