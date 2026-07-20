import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AppModule } from '../src/app.module';

/**
 * Emits the API's OpenAPI document to a file, WITHOUT starting the HTTP server.
 *
 * This is the source of truth for `@cpe/shared-types`: the admin dashboard's types are generated
 * from this document, so a controller and its consumer cannot drift out of type sync — a removed
 * field or a renamed route becomes a TypeScript error in the admin build, not a runtime 500 a
 * support agent hits mid-incident.
 *
 * It boots the full Nest app (so every route and DTO is registered) with logging and the network
 * listener off, builds the document, writes it, and tears down. Requires the same infra as the
 * app itself to be reachable, because module init opens the DB/Redis connections.
 */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  // Mirror the real app's prefix + URI versioning so the emitted paths match what clients call
  // (`/api/v1/...`). Kept in step with configure-app.ts by hand — both are simple and stable.
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Circular Paper Economy API')
      .setDescription('Contract for the internal ops console (@cpe/admin) and any future client.')
      .setVersion('0.0.0')
      .addBearerAuth()
      .build(),
  );

  const outPath = resolve(__dirname, '../openapi.json');
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI document written to ${outPath}`);

  await app.close();
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('Failed to generate OpenAPI document:', error);
    process.exit(1);
  },
);
