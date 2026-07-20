import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { type Role } from '@/modules/auth/domain/value-objects/role';
import { AUDIT_REPOSITORY, type AuditRepository } from '../domain/ports/audit.repository';
import { pickTargetId, redactAuditPayload } from '../domain/redaction';

/**
 * Records "who did what, to what, when" — once, globally — for every mutating action taken by a
 * staff member. Doing this in an interceptor rather than in each controller is the whole point:
 * the one admin endpoint a developer forgets to log by hand is precisely the action a reviewer
 * later needs and cannot find. Here, a new admin route is audited the moment it exists, for free.
 *
 * Scope, deliberately narrow:
 *  - Only MUTATIONS (POST/PUT/PATCH/DELETE). A GET changed nothing worth a permanent row.
 *  - Only STAFF/ADMIN roles. A customer adding to their own cart is not an "admin action", and
 *    auditing every self-service write would bury the trail that matters in noise.
 *  - Only on SUCCESS (2xx). A rejected action did nothing; the rejection is a log line, not an
 *    audit record of a change that never happened.
 *
 * The write is best-effort and off the response's critical path: a failure to record must not
 * turn a successful, already-committed admin action into a 500. It is logged loudly instead, so
 * a broken audit pipeline is visible rather than silent.
 */
const AUDITED_ROLES: readonly Role[] = [
  'OPS_STAFF',
  'SUPER_ADMIN',
  'APARTMENT_ADMIN',
  'BUSINESS_ADMIN',
  'RECYCLING_PARTNER_ADMIN',
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // Not an auditable action: skip before doing any work.
    if (
      user === undefined ||
      !MUTATING_METHODS.has(request.method) ||
      !AUDITED_ROLES.includes(user.role)
    ) {
      return next.handle();
    }

    // Capture request facts NOW — the body is consumed downstream, and after the handler runs
    // the params object can be reused. Redact before anything is retained.
    const method = request.method;
    const params = { ...(request.params as Record<string, string>) };
    const routePath = getRoutePath(request);
    const record = {
      actorUserId: user.id,
      actorRole: user.role,
      action: `${method} ${routePath}`,
      method,
      path: request.originalUrl,
      targetType: deriveTargetType(routePath),
      targetId: pickTargetId(params),
      ip: request.ip ?? null,
      metadata: redactAuditPayload({
        params,
        query: request.query,
        body: request.body as unknown,
      }),
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = context.switchToHttp().getResponse<Response>().statusCode;
          if (statusCode >= 200 && statusCode < 300) {
            void this.write({ ...record, statusCode });
          }
        },
        // On error the handler threw; nothing was (or should be) recorded as a completed change.
      }),
    );
  }

  private async write(input: Parameters<AuditRepository['record']>[0]): Promise<void> {
    try {
      await this.audit.record(input);
    } catch (error) {
      // A broken audit pipeline must be loud, but must never fail the action it is recording —
      // the action already committed. Alerting on this log is a monitoring concern (Phase 14).
      this.logger.error(
        `Failed to write audit row for ${input.action} by ${input.actorUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/** The matched route pattern (e.g. `/admin/wallet/adjustments`), falling back to the concrete path. */
function getRoutePath(request: Request): string {
  const route = (request as { route?: { path?: string } }).route;
  return route?.path ?? request.path;
}

/**
 * A coarse entity kind from the route, for filtering ("show me everything done to wallets").
 * Best-effort: the segment after `admin`, or the first meaningful segment.
 */
function deriveTargetType(routePath: string): string | null {
  const segments = routePath.split('/').filter((s) => s.length > 0 && !s.startsWith(':'));
  const adminIndex = segments.indexOf('admin');
  const candidate = adminIndex >= 0 ? segments[adminIndex + 1] : segments[0];
  return candidate ?? null;
}
