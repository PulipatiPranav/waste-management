import { type ProbeResult } from '../ports/health-probe.port';

export type OverallStatus = 'ok' | 'degraded' | 'error';

/**
 * The rule for turning a set of probe results into one status.
 *
 * It lives in the domain rather than the controller because Kubernetes acts on it:
 * a readiness probe that returns `ok` while the database is unreachable takes a
 * broken pod into the load-balancer rotation.
 */
export class HealthReport {
  private constructor(
    readonly status: OverallStatus,
    readonly probes: readonly ProbeResult[],
    readonly checkedAt: Date,
  ) {}

  static fromProbes(probes: readonly ProbeResult[], checkedAt: Date = new Date()): HealthReport {
    return new HealthReport(HealthReport.deriveStatus(probes), probes, checkedAt);
  }

  /** True when the process should be taken out of the load-balancer rotation. */
  get isReady(): boolean {
    return this.status === 'ok';
  }

  private static deriveStatus(probes: readonly ProbeResult[]): OverallStatus {
    if (probes.length === 0) return 'ok';

    const down = probes.filter((probe) => probe.status === 'down');
    if (down.length === 0) return 'ok';
    if (down.length === probes.length) return 'error';
    return 'degraded';
  }
}
