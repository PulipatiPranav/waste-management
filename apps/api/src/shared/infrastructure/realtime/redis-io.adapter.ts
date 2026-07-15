import { type INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { type ServerOptions } from 'socket.io';

import { RedisService } from '@/shared/infrastructure/cache/redis.service';

/**
 * Makes WebSocket events work across MORE THAN ONE API replica.
 *
 * socket.io's default adapter is in-process: a room lives inside a single Node process. So
 * with two replicas behind a load balancer, an admin connected to pod A and a delivery
 * completion handled by pod B mean the event is emitted into pod B's copy of the room —
 * which is empty. The emit succeeds, reaches nobody, and throws nothing.
 *
 * The failure mode is the nasty kind: the dashboard works perfectly on one replica (so it
 * works in dev, in CI, and in a single-pod staging), and then silently goes half-dead the
 * moment production scales to two. Roughly half the events vanish, depending on which pod
 * each admin happened to connect to.
 *
 * The Redis adapter fans every emit out over pub/sub, so a room spans all replicas. Redis
 * is already a dependency (rate limiting, BullMQ), so this costs nothing new.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connect(): Promise<void> {
    const redis = this.app.get(RedisService);

    // A pub/sub connection cannot issue ordinary commands, so socket.io needs its own
    // pair — it cannot share the client the rate limiter uses.
    const pubClient = redis.client.duplicate();
    const subClient = redis.client.duplicate();

    await Promise.all([pubClient.connect?.(), subClient.connect?.()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);

    this.logger.log('WebSocket events will fan out across replicas via Redis pub/sub');
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (adapter: unknown) => void;
    };

    if (this.adapterConstructor !== undefined) {
      server.adapter(this.adapterConstructor);
    } else {
      // Reached only if connect() was never awaited. Loud, because the symptom otherwise is
      // a dashboard that quietly misses half its events under load.
      this.logger.error(
        'Redis adapter was not initialised: WebSocket events will NOT reach admins on other replicas.',
      );
    }

    return server;
  }
}
