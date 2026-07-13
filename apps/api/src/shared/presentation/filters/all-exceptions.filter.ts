import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiErrorResponse } from '@cpe/shared-types';
import { type Request, type Response } from 'express';

import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvariantViolationError,
  NotFoundError,
} from '@/shared/domain/errors/domain.error';

/**
 * The one place where an exception becomes an HTTP response.
 *
 * Every failure leaves the API in the `ApiErrorResponse` shape from
 * `@cpe/shared-types`, so the mobile app and admin dashboard parse errors exactly
 * one way. Unrecognised exceptions become a generic 500 — internals such as SQL
 * text or stack traces must never reach a client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, code, message, details } = this.describe(exception);

    const body: ApiErrorResponse = {
      statusCode: status,
      code,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId ?? 'unknown',
      ...(details ? { details } : {}),
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} [${body.correlationId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${code} (${message})`);
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, string[]>;
  } {
    if (exception instanceof DomainError) {
      return {
        status: this.statusForDomainError(exception),
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // ValidationPipe puts its field errors in `message` as a string[].
      if (typeof payload === 'object' && payload !== null && 'message' in payload) {
        const raw: unknown = payload.message;
        if (Array.isArray(raw)) {
          return {
            status,
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: { _errors: raw.map((entry) => String(entry)) },
          };
        }
      }

      return { status, code: this.codeFromStatus(status), message: exception.message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private statusForDomainError(error: DomainError): number {
    if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
    if (error instanceof ConflictError) return HttpStatus.CONFLICT;
    if (error instanceof ForbiddenError) return HttpStatus.FORBIDDEN;
    if (error instanceof InvariantViolationError) return HttpStatus.UNPROCESSABLE_ENTITY;
    return HttpStatus.BAD_REQUEST;
  }

  private codeFromStatus(status: number): string {
    const codes: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
    };

    return codes[status] ?? 'HTTP_ERROR';
  }
}
