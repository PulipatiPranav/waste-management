import { SetMetadata } from '@nestjs/common';

import { type Role } from '../../domain/value-objects/role';

export const ROLES_KEY = 'auth:roles';

/**
 * Restricts an endpoint to the listed roles. Enforced by RolesGuard.
 *
 * Typed as `Role`, not `string`, so `@Roles('OPS_STAF')` is a compile error rather
 * than an endpoint that silently admits nobody — or, worse, a typo'd role name that
 * quietly never matches and so appears to "work" during testing with a SUPER_ADMIN.
 */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);
