import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // In deployed environments the variables come from the orchestrator's
      // secret store, not a file on disk; a missing .env there is expected.
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
