import { Injectable } from '@nestjs/common';
import { type ThrottlerStorage } from '@nestjs/throttler';

import { RedisService } from '@/shared/infrastructure/cache/redis.service';

/**
 * `ThrottlerStorageRecord` is not re-exported from the package root, and reaching into
 * `@nestjs/throttler/dist/...` would break on any internal reshuffle. The interface is
 * structural, so declaring the shape here is both safer and self-documenting.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed storage for @nestjs/throttler, replacing its in-memory default.
 *
 * The default store is per-process. With N replicas behind a load balancer that means
 * an attacker gets N× the configured budget simply by being round-robined across pods
 * — the limit you wrote down is not the limit you get, and it silently loosens every
 * time the deployment scales up. On an endpoint whose abuse costs real money (every
 * OTP is a paid SMS), that is not acceptable.
 *
 * A useful side effect: because the counters live in Redis, the e2e suite can flush
 * them between tests, so rate-limit behaviour is deterministic rather than dependent
 * on which test ran first.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `ratelimit:throttler:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    // Already serving a block: report it without counting the hit, so hammering the
    // endpoint while blocked cannot extend the block indefinitely.
    const blockedTtl = await this.redis.client.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: Math.ceil(blockedTtl / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }

    const results = await this.redis.client.multi().incr(hitKey).pttl(hitKey).exec();

    if (results === null) {
      // Fail CLOSED. A throttler that quietly stops throttling when Redis blips is
      // worse than no throttler, because nobody notices.
      throw new Error('Throttler storage unavailable: Redis transaction returned no result');
    }

    const totalHits = Number(results[0]?.[1] ?? 0);
    let ttlMs = Number(results[1]?.[1] ?? -1);

    // Set the window only on the first hit. Refreshing it on every request would slide
    // the window forward forever, so a persistent caller would never be let back in.
    if (ttlMs < 0) {
      await this.redis.client.pexpire(hitKey, ttl);
      ttlMs = ttl;
    }

    if (totalHits > limit && blockDuration > 0) {
      await this.redis.client.set(blockKey, '1', 'PX', blockDuration);

      return {
        totalHits,
        timeToExpire: Math.ceil(blockDuration / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
