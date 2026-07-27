import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type Observable } from 'rxjs';

import { MetricsService } from './metrics.service';

/**
 * Records one `http_request_duration_seconds` observation per request.
 *
 * The measurement is taken on the response's `finish` event, not in an rxjs operator, so the status
 * is the FINAL one the client sees — set by `AllExceptionsFilter`, which runs after this interceptor.
 * Measuring in a `tap({ error })` would record the wrong status (still 200) or force this file to
 * re-derive the exception→status mapping the filter owns.
 *
 * The `route` label is the handler identity (`Controller.method`), not the raw URL. Labelling by URL
 * would put every `/pickups/<uuid>` on its own time series and blow up Prometheus cardinality; the
 * handler name is bounded and points at exactly one endpoint.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const url = req.originalUrl || req.url || '';
    // Never meter the probes or the scrape itself — high-frequency noise that hides real traffic.
    if (url.startsWith('/health/') || url === '/metrics' || url.startsWith('/metrics?')) {
      return next.handle();
    }

    const controller = context.getClass().name.replace(/Controller$/, '');
    const handler = context.getHandler().name;
    const route = `${controller}.${handler}`;
    const start = process.hrtime.bigint();

    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.observeHttp(req.method, route, res.statusCode, seconds);
    });

    return next.handle();
  }
}
