import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { type Env } from '@/config/env.schema';
import { buildPinoHttpOptions } from './logger.config';

/**
 * Replaces Nest's default text logger with structured JSON logging (pino), correlation-id-per-line.
 *
 * Global so every module resolves the same `Logger`. `main.ts` calls `app.useLogger(app.get(Logger))`
 * with `bufferLogs: true`, so even boot-time logs come out as JSON through this pipeline rather than
 * the default console formatter.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: buildPinoHttpOptions(config.get('LOG_LEVEL', { infer: true })),
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
