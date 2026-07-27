import { Controller, ForbiddenException, Get, Header, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Response } from 'express';

import { type Env } from '@/config/env.schema';
import { Public } from '@/modules/auth/presentation/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * The Prometheus scrape endpoint, at exactly `/metrics` (VERSION_NEUTRAL + excluded from the API
 * prefix, like the health probes) so a scrape config points at a stable path.
 *
 * `@Public` because Prometheus cannot present a bearer token, and `@SkipThrottle` because it is
 * scraped every few seconds forever. In a real deployment `/metrics` is NOT exposed on the public
 * ingress — it is reachable only from inside the cluster (a ServiceMonitor / a separate port). This
 * app additionally lets it be switched off entirely with `METRICS_ENABLED=false`.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    if (!this.config.get('METRICS_ENABLED', { infer: true })) {
      throw new ForbiddenException('Metrics endpoint is disabled.');
    }
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.render());
  }
}
