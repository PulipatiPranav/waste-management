import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { type Env } from './config/env.schema';
import { RedisIoAdapter } from './shared/infrastructure/realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // `rawBody: true` preserves the exact request bytes on `req.rawBody`, which the payment
  // webhook needs: its HMAC signature is over the raw body, and a re-serialised parsed JSON
  // has different whitespace and key order, so every valid webhook would fail to verify.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = new Logger('Bootstrap');

  // Shared with the e2e suite, so the tests exercise the app as it actually runs.
  configureApp(app);

  // Lets Kubernetes drain in-flight requests before the process exits.
  app.enableShutdownHooks();

  // WebSocket rooms must span replicas. socket.io's default adapter is in-process, so with
  // two pods an event emitted on pod B never reaches an admin connected to pod A — the
  // dashboard works perfectly on one replica and silently goes half-dead on two.
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Circular Paper Economy API')
        .setDescription(
          'Newspaper subscription, recyclable paper pickup, wallet and cashback, recycling partner handoff.',
        )
        .setVersion('0.0.0')
        .addBearerAuth()
        .build(),
    );

    // A later phase generates @cpe/shared-types from this spec.
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  }

  const port = config.get('PORT', { infer: true });
  const prefix = config.get('API_PREFIX', { infer: true });

  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}${prefix}/v1`);
  logger.log(`Health probes at http://localhost:${port}/health/live and /health/ready`);
}

void bootstrap();
