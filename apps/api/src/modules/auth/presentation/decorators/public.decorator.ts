import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks an endpoint as reachable without a token.
 *
 * The JwtAuthGuard is registered GLOBALLY, so authentication is the default and
 * exposure is the explicit, greppable exception. The inverse — remembering to add a
 * guard to each new controller — fails open: the one endpoint someone forgets is
 * unauthenticated, and nothing tells you.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
