import { Inject, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { type Namespace, type Server, type Socket } from 'socket.io';

import { TOKEN_ISSUER, type TokenIssuer } from '@/modules/auth/domain/ports/token-issuer.port';
import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import {
  type DeliveryEventPublisher,
  type StopStatusChangedEvent,
} from '../../domain/ports/delivery-events.port';

/** Only staff may watch the live delivery feed. It is a map of where customers live. */
const ADMIN_ROOM = 'delivery:admin';

const NAMESPACE = '/delivery';

/**
 * Live delivery status for the ops dashboard.
 *
 * The global JwtAuthGuard does NOT protect WebSocket connections — it is an HTTP guard,
 * and a socket handshake never passes through it. Authentication here is therefore
 * explicit, in handleConnection, and it is the only thing standing between an anonymous
 * client and a real-time feed of customers' delivery addresses. Getting this wrong is
 * the classic way a "the API is secured" system leaks everything over a socket.
 */
@WebSocketGateway({
  namespace: NAMESPACE,
  cors: { origin: false },
})
export class DeliveryGateway
  implements OnGatewayConnection, OnGatewayDisconnect, DeliveryEventPublisher
{
  private readonly logger = new Logger(DeliveryGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    @Inject(TOKEN_ISSUER) private readonly tokenIssuer: TokenIssuer,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (token === null) {
      this.reject(client, 'No access token supplied');
      return;
    }

    const claims = await this.tokenIssuer.verifyAccessToken(token);

    if (claims === null) {
      this.reject(client, 'Invalid or expired access token');
      return;
    }

    // Role read from the DATABASE, not the token — the same rule as the HTTP guard. A
    // socket can stay open for hours, so a token minted before a demotion must not keep
    // its holder in the admin room.
    const user = await this.users.findById(claims.sub);

    if (!user?.isActive) {
      this.reject(client, 'Account is not active');
      return;
    }

    if (user.role !== 'OPS_STAFF' && user.role !== 'SUPER_ADMIN') {
      this.reject(client, 'Staff only');
      return;
    }

    await client.join(ADMIN_ROOM);
    this.logger.log(`Admin socket connected: ${client.id} (${user.role})`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  /**
   * Fan out a status change to the admin room.
   *
   * Synchronous and failure-swallowing on purpose. The partner is standing at a
   * customer's door and the delivery is already recorded in Postgres; a dead socket
   * must never turn that into a failed request. The dashboard can refetch.
   *
   * NOTE for Phase 15: with more than one API replica, socket.io needs a Redis adapter
   * or an event only reaches the admins connected to the SAME pod. Redis is already a
   * dependency; this is a wiring change, not a redesign.
   */
  stopStatusChanged(event: StopStatusChangedEvent): void {
    try {
      this.namespace().to(ADMIN_ROOM).emit('delivery.stop_status_changed', event);
    } catch (error) {
      this.logger.error(
        `Failed to publish stop status change for ${event.stopId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * The `/delivery` namespace, which is where the admin room actually lives.
   *
   * `@WebSocketServer()` injects the ROOT `io.Server`, not this gateway's namespace.
   * So `this.server.to(room)` addresses the room in namespace `/` — which is empty,
   * because every admin joined the room in `/delivery`. The emit succeeds, reaches
   * nobody, and throws nothing: the dashboard just silently never updates, which is
   * precisely the kind of bug that survives a green test suite.
   *
   * Narrowing on `.of` rather than casting, so this keeps working if a future Nest
   * version starts injecting the namespace directly.
   */
  private namespace(): Namespace {
    const server = this.server as unknown as Server | Namespace;

    return typeof (server as Server).of === 'function'
      ? (server as Server).of(NAMESPACE)
      : (server as Namespace);
  }

  /**
   * Token from the handshake `auth` payload, or an `Authorization: Bearer` header.
   *
   * Deliberately NOT from the query string: query strings are logged by proxies, load
   * balancers and browser history, and an access token in a log file is a credential
   * anyone with log access can replay.
   */
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown };

    if (typeof auth.token === 'string' && auth.token.length > 0) {
      return auth.token;
    }

    const header = client.handshake.headers.authorization;

    if (typeof header === 'string') {
      const [scheme, token] = header.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && token !== undefined && token.length > 0) {
        return token;
      }
    }

    return null;
  }

  private reject(client: Socket, reason: string): void {
    this.logger.warn(`Rejected socket ${client.id}: ${reason}`);
    client.emit('error', { message: reason });
    client.disconnect(true);
  }
}
