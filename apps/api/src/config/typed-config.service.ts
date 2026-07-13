import type { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * `ConfigService` narrowed to the validated env schema, so `get('PORT')` is typed
 * as `number` and a typo in the key is a compile error rather than `undefined`.
 *
 * Inject this, not the raw `ConfigService`.
 */
export type TypedConfigService = ConfigService<Env, true>;
