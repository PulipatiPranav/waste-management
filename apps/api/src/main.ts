import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { type Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = new Logger('Bootstrap');

  // Shared with the e2e suite, so the tests exercise the app as it actually runs.
  configureApp(app);

  // Lets Kubernetes drain in-flight requests before the process exits.
  app.enableShutdownHooks();

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
