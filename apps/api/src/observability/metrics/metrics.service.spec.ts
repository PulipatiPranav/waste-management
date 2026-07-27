import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    // Each instance owns an isolated registry, so constructing one per test is safe (no
    // "metric already registered" collision with the prom-client global default).
    metrics = new MetricsService();
  });

  it('exposes default process metrics in the exposition text', async () => {
    const text = await metrics.render();
    expect(text).toContain('process_cpu_user_seconds_total');
    expect(text).toContain('nodejs_eventloop_lag_seconds');
  });

  it('records an HTTP observation with method/route/status labels', async () => {
    metrics.observeHttp('POST', 'PartnerPickups.complete', 200, 0.042);
    const text = await metrics.render();
    expect(text).toContain('http_request_duration_seconds_count');
    expect(text).toContain('method="POST"');
    expect(text).toContain('route="PartnerPickups.complete"');
    expect(text).toContain('status="200"');
  });

  it('counts wallet credits by reason', async () => {
    metrics.incWalletCredit('pickup_cashback');
    metrics.incWalletCredit('pickup_cashback');
    metrics.incWalletCredit('admin_adjustment');
    const text = await metrics.render();
    expect(text).toContain('wallet_credit_total{reason="pickup_cashback"} 2');
    expect(text).toContain('wallet_credit_total{reason="admin_adjustment"} 1');
  });

  it('counts pickups completed', async () => {
    metrics.incPickupCompleted();
    metrics.incPickupCompleted();
    metrics.incPickupCompleted();
    const text = await metrics.render();
    expect(text).toContain('pickup_completed_total 3');
  });

  it('advertises the Prometheus content type', () => {
    expect(metrics.contentType).toContain('text/plain');
  });
});
