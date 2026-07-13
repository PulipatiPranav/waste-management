import { Injectable } from '@nestjs/common';

import { RedisService } from '@/shared/infrastructure/cache/redis.service';
import { type RateLimitDecision, type RateLimiter } from '../../domain/ports/rate-limiter.port';

/**
 * Fixed-window counter in Redis.
 *
 * Redis rather than in-process memory because the API runs as several replicas:
 * an in-memory counter gives an attacker `replicas`× the intended budget for free,
 * simply by spreading requests across pods. This is precisely the flaw in
 * @nestjs/throttler's default in-memory storage, which is why the OTP limits — the
 * ones that actually cost money when abused — do not rely on it.
 */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const namespaced = `ratelimit:${key}`;

    // INCR then a conditional EXPIRE, pipelined into one round trip.
    //
    // The EXPIRE must only be set when the counter is newly created (count === 1).
    // Refreshing the TTL on every hit would slide the window forward indefinitely, so
    // a caller who keeps knocking would never be let back in — the counter would
    // outlive its own window and the block would become permanent.
    const results = await this.redis.client.multi().incr(namespaced).ttl(namespaced).exec();

    if (results === null) {
      // A Redis failure must not silently disable rate limiting. Fail CLOSED: an OTP
      // endpoint with its limiter switched off is an open SMS-billing tap.
      throw new Error('Rate limiter unavailable: Redis transaction returned no result');
    }

    const count = Number(results[0]?.[1] ?? 0);
    let ttl = Number(results[1]?.[1] ?? -1);

    if (ttl < 0) {
      await this.redis.client.expire(namespaced, windowSeconds);
      ttl = windowSeconds;
    }

    const allowed = count <= limit;

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed ? 0 : ttl,
    };
  }

  async reset(key: string): Promise<void> {
    await this.redis.client.del(`ratelimit:${key}`);
  }
}
