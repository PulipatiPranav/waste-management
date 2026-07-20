import type { components } from './generated/api.js';

/**
 * Shorthand for the generated schema map. `Schemas['WalletDto']` reads a lot better than
 * `components['schemas']['WalletDto']` at every call site, and it is the one name a consumer
 * needs to import to type any request or response body.
 */
export type Schemas = components['schemas'];
