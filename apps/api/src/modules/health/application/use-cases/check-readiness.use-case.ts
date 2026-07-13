import { Inject, Injectable } from '@nestjs/common';

import { HealthReport } from '../../domain/entities/health-report';
import { HEALTH_PROBES, type HealthProbe } from '../../domain/ports/health-probe.port';

/**
 * Runs every registered probe and folds the results into a `HealthReport`.
 *
 * Probes run concurrently and a thrown probe is caught by the probe itself, so one
 * slow or broken dependency cannot stall or crash the readiness endpoint.
 */
@Injectable()
export class CheckReadinessUseCase {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: readonly HealthProbe[]) {}

  async execute(): Promise<HealthReport> {
    const results = await Promise.all(this.probes.map((probe) => probe.check()));
    return HealthReport.fromProbes(results);
  }
}
