import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { type Env } from '@/config/env.schema';

/**
 * Redis connection, used later for BullMQ queues, OTP throttling and cached
 * sustainability aggregates. Nothing depends on it yet beyond the readiness probe.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    const password = config.get('REDIS_PASSWORD', { infer: true });

    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      ...(password ? { password } : {}),
      // BullMQ requires this to be null, and it stops commands from failing fast
      // during a transient reconnect.
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Connected to Redis');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Disconnected from Redis');
  }

  /** Cheap round-trip used by the readiness probe. */
  async ping(): Promise<void> {
    await this.client.ping();
  }
}
