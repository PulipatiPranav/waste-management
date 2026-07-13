import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type ApiErrorResponse, type HealthCheckResponse } from '@cpe/shared-types';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { CORRELATION_ID_HEADER } from '@/shared/presentation/middleware/correlation-id.middleware';
import { type ReadinessResponseDto } from '@/modules/health/presentation/dto/readiness-response.dto';

/**
 * Boots the real application graph against real Postgres and Redis.
 *
 * Unlike the unit tests, this one needs the containers up:
 *   pnpm dev:infra   (locally)
 * CI supplies them as service containers. It is the only check that proves the
 * Prisma client, the config validation and the DI wiring actually agree with each
 * other at runtime rather than merely type-checking.
 *
 * It calls the same `configureApp` as main.ts on purpose. An earlier version
 * hand-rolled a subset of that config here, and as a result it asserted against
 * routes that did not exist in the real server: the health endpoints passed at
 * /health/live in the test while the deployed app served them at /v1/health/live.
 * The URL assertions below are only meaningful because both paths go through the
 * same configuration.
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns 200 without touching any dependency', async () => {
    const response = await request(app.getHttpServer()).get('/health/live').expect(200);
    const body = response.body as HealthCheckResponse;

    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('GET /health/ready reports every dependency up', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
    const body = response.body as ReadinessResponseDto;

    expect(body.status).toBe('ok');
    expect(body.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'postgres', status: 'up' }),
        expect.objectContaining({ name: 'redis', status: 'up' }),
      ]),
    );
  });

  // Regression guard. URI versioning previously moved the health endpoints to
  // /v1/health/live, which meant every Kubernetes probe 404'd on deploy while CI
  // stayed green. These two assertions are what make that a test failure.
  it('serves health outside the version prefix, where the k8s probes point', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/v1/health/live').expect(404);
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
  });

  it('echoes back the correlation ID the caller supplied', async () => {
    const correlationId = 'test-correlation-id';

    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set(CORRELATION_ID_HEADER, correlationId)
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe(correlationId);
  });

  it('returns the shared ApiErrorResponse shape on an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    const body = response.body as ApiErrorResponse;

    expect(body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/v1/does-not-exist',
    });
    expect(body.correlationId).toEqual(expect.any(String));
  });
});
