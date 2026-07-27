import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics. Global so any module can inject `MetricsService` to record a business event
 * (wallet credits, pickup completions) without importing this module explicitly.
 *
 * The HTTP interceptor is registered globally here, so every request is metered by adding this one
 * module rather than by remembering to wire an interceptor per controller.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
  exports: [MetricsService],
})
export class MetricsModule {}
