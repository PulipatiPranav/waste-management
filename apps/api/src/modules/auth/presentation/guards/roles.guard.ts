import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';

import { ForbiddenError } from '@/shared/domain/errors/domain.error';
import { UnauthenticatedError } from '../../domain/errors/auth.errors';
import { type Role } from '../../domain/value-objects/role';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Enforces `@Roles(...)`. Runs after JwtAuthGuard, which has already put the user —
 * with the role read from the database, not the token — on the request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles on the endpoint: any authenticated user may proceed. Authentication
    // itself is still mandatory — that is JwtAuthGuard's job, not this one's.
    if (required === undefined || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (user === undefined) {
      // Means @Roles was combined with @Public. That is always a mistake, and silently
      // allowing it would leave a "restricted" endpoint wide open.
      throw new UnauthenticatedError('Authentication is required.');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenError('You do not have permission to perform this action.');
    }

    return true;
  }
}
