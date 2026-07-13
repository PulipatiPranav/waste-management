import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type HealthProbe, type ProbeResult } from '../../domain/ports/health-probe.port';

@Injectable()
export class PostgresProbe implements HealthProbe {
  readonly name = 'postgres';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<ProbeResult> {
    const startedAt = Date.now();

    try {
      await this.prisma.ping();
      return { name: this.name, status: 'up', durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
