import { z } from 'zod';

/**
 * Every environment variable the API reads, in one place.
 *
 * The process must fail loudly at boot on a missing or malformed variable rather
 * than surfacing it as an undefined at 2am inside a wallet-credit job. Nothing
 * outside this file should read `process.env` directly.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Public base path for the HTTP API, e.g. `/api`. */
  API_PREFIX: z.string().startsWith('/').default('/api'),

  /** Comma-separated list of allowed browser origins for CORS. */
  CORS_ORIGINS: z.string().default('http://localhost:3001'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Swagger UI is served only when this is true; keep it false in production. */
  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Passed to `ConfigModule.forRoot({ validate })`. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nSee apps/api/.env.example for the expected variables.`,
    );
  }

  return result.data;
}
