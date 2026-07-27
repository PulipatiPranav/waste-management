import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Express } from 'express';
import helmet from 'helmet';

import { type Env } from '@/config/env.schema';
import { AllExceptionsFilter } from '@/shared/presentation/filters/all-exceptions.filter';
import { installBigIntSerialization } from './bigint-serialization';

/**
 * Everything that turns a bare Nest app into *our* app.
 *
 * Both `main.ts` and the e2e tests call this, and that is the entire point. When
 * the test harness configured the app differently from production, the e2e suite
 * happily passed against routes that did not exist in the deployed server — the
 * health endpoints 404'd in production while going green in CI. One function, one
 * behaviour, both callers.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // A BigInt reaching a response body would otherwise throw at JSON.stringify and become a
  // 500. Every money column in this system is a BigInt. See the file for why it serialises
  // as a string rather than a number.
  installBigIntSerialization();

  // Behind an ingress/load balancer, the socket's peer address is the proxy's, not the
  // client's. Without this, `request.ip` is the same value for EVERY request, so the
  // per-IP OTP limit degenerates into one global bucket that a single attacker can
  // exhaust — locking every real user out of login.
  //
  // `1` = trust exactly one proxy hop (the ingress). Do NOT set this to `true`: that
  // trusts the whole X-Forwarded-For chain, letting a client spoof its own IP by
  // sending the header, which hands them an unlimited supply of fresh rate-limit
  // buckets. If a second proxy is added in front, this number must go up with it.
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 1);

  app.use(helmet());

  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });

  // Health endpoints are excluded from the /api prefix AND declared VERSION_NEUTRAL
  // on the controller, so they resolve at exactly /health/live and /health/ready.
  // Kubernetes probes are configured against those literal paths; a version bump
  // must never move them.
  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }), {
    // `/metrics` joins the health probes at a fixed, unprefixed, version-neutral path so the
    // Prometheus scrape config and k8s probes point at literal paths a version bump cannot move.
    exclude: ['health/live', 'health/ready', 'metrics'],
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown properties outright rather than silently dropping them: a
      // client sending `amount` to an endpoint expecting `amountKg` should get an
      // error, not a default.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}
