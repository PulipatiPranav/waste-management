import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * The process's Prometheus registry and the metrics we expose.
 *
 * One registry per process, isolated (not the prom-client global default) so a test can construct a
 * MetricsService without colliding with another instance's already-registered metric names. Default
 * Node metrics (event-loop lag, heap, GC, open handles) come for free; on top we record an HTTP
 * histogram (latency + throughput + error rate per route — what you watch while load-testing) and
 * two business counters for the money paths the brief calls out.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /** Request latency and count, sliced by method/route/status — the load-test's primary signal. */
  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    // Buckets tuned for an API: sub-10ms to multi-second, so p50 and the slow tail are both visible.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  /** Wallet credits applied (cashback on pickup completion, admin adjustments). */
  private readonly walletCredits = new Counter({
    name: 'wallet_credit_total',
    help: 'Number of wallet credit operations applied',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  /** Pickups completed (the highest-consistency-risk write in the product). */
  private readonly pickupsCompleted = new Counter({
    name: 'pickup_completed_total',
    help: 'Number of pickups completed',
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  /** Records one finished HTTP request. `route` is the templated path, never the raw URL. */
  observeHttp(method: string, route: string, status: number, durationSeconds: number): void {
    this.httpDuration.observe({ method, route, status: String(status) }, durationSeconds);
  }

  incWalletCredit(reason: 'pickup_cashback' | 'admin_adjustment'): void {
    this.walletCredits.inc({ reason });
  }

  incPickupCompleted(): void {
    this.pickupsCompleted.inc();
  }

  /** The Prometheus exposition text served at `GET /metrics`. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
