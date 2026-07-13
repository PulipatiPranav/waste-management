import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';

import { CheckReadinessUseCase } from '../application/use-cases/check-readiness.use-case';
import { ReadinessResponseDto } from './dto/readiness-response.dto';
import { LivenessResponseDto } from './dto/liveness-response.dto';

/**
 * Liveness and readiness are separate on purpose, and Kubernetes treats them
 * differently: a failing liveness probe restarts the pod, a failing readiness probe
 * only pulls it from the load balancer. Restarting the API because Postgres is down
 * fixes nothing and turns a database blip into a crash-loop.
 */
@ApiTags('health')
// VERSION_NEUTRAL, plus the `exclude` in configureApp, is what pins these at exactly
// /health/live and /health/ready. Without it, URI versioning silently serves them at
// /v1/health/live and every Kubernetes probe 404s — the pod never becomes ready and
// the rollout stalls with a green CI run behind it.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly checkReadiness: CheckReadinessUseCase) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 whenever the process is running. Checks no dependencies.',
  })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '0.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks every downstream dependency. Returns 503 unless all of them are reachable.',
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponseDto> {
    const report = await this.checkReadiness.execute();

    res.status(report.isReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: report.status,
      checkedAt: report.checkedAt.toISOString(),
      probes: report.probes.map((probe) => ({
        name: probe.name,
        status: probe.status,
        durationMs: probe.durationMs,
      })),
    };
  }
}
