import { Test } from '@nestjs/testing';

import { HEALTH_PROBES, type HealthProbe } from '../../domain/ports/health-probe.port';
import { CheckReadinessUseCase } from './check-readiness.use-case';

/**
 * The use case is tested against fake probes, with no database and no Redis —
 * which is the point of the port/adapter split. If this test ever needs a running
 * container to pass, a layering rule has been broken.
 */
const probe = (name: string, status: 'up' | 'down'): HealthProbe => ({
  name,
  check: () => Promise.resolve({ name, status, durationMs: 1 }),
});

async function buildUseCase(probes: HealthProbe[]): Promise<CheckReadinessUseCase> {
  const moduleRef = await Test.createTestingModule({
    providers: [CheckReadinessUseCase, { provide: HEALTH_PROBES, useValue: probes }],
  }).compile();

  return moduleRef.get(CheckReadinessUseCase);
}

describe('CheckReadinessUseCase', () => {
  it('reports ok when every probe is up', async () => {
    const useCase = await buildUseCase([probe('postgres', 'up'), probe('redis', 'up')]);

    const report = await useCase.execute();

    expect(report.status).toBe('ok');
    expect(report.isReady).toBe(true);
  });

  it('reports degraded when some but not all probes are down', async () => {
    const useCase = await buildUseCase([probe('postgres', 'up'), probe('redis', 'down')]);

    const report = await useCase.execute();

    expect(report.status).toBe('degraded');
    expect(report.isReady).toBe(false);
  });

  it('reports error when every probe is down', async () => {
    const useCase = await buildUseCase([probe('postgres', 'down'), probe('redis', 'down')]);

    const report = await useCase.execute();

    expect(report.status).toBe('error');
    expect(report.isReady).toBe(false);
  });

  it('runs probes concurrently rather than in sequence', async () => {
    const slowProbe = (name: string): HealthProbe => ({
      name,
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { name, status: 'up' as const, durationMs: 50 };
      },
    });

    const useCase = await buildUseCase([slowProbe('a'), slowProbe('b'), slowProbe('c')]);

    const startedAt = Date.now();
    await useCase.execute();
    const elapsed = Date.now() - startedAt;

    // Sequential execution would take ~150ms; allow generous headroom for CI jitter.
    expect(elapsed).toBeLessThan(120);
  });
});
