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

  // --- Auth -----------------------------------------------------------------

  /**
   * Signing key for access tokens. No default, deliberately: a fallback secret is
   * one forgotten env var away from a production system that anyone can mint an
   * admin token for. The process must refuse to boot without a real one.
   *
   * Generate: `openssl rand -base64 48`
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters of entropy'),

  /** Short by design — a leaked access token stops working quickly. */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15m

  /** Refresh tokens rotate on every use, so a long TTL is safe. */
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30d

  // --- OTP ------------------------------------------------------------------

  /** The brief says 5 minutes. Shorter is safer; longer annoys users on slow SMS. */
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),

  /** Wrong guesses before the challenge is dead. Caps online brute force. */
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  /**
   * Per-phone and per-IP request budgets. Both are needed: per-phone alone lets one
   * attacker walk the whole phone-number space from a single host, and per-IP alone
   * lets a botnet hammer one victim's number (SMS-bombing them, and burning our
   * money — every OTP is a paid SMS).
   */
  OTP_MAX_REQUESTS_PER_PHONE: z.coerce.number().int().positive().default(5),
  OTP_PHONE_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  OTP_MAX_REQUESTS_PER_IP: z.coerce.number().int().positive().default(20),
  OTP_IP_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),

  /**
   * `console` prints the OTP to the log for local development.
   * It is REFUSED in production (see the superRefine below) — shipping it would mean
   * no user ever receives a code, and every code is printed into the log stream.
   */
  SMS_PROVIDER: z.enum(['console']).default('console'),
});

/**
 * Cross-field rules that a per-field schema cannot express.
 */
export const envSchemaWithRules = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMS_PROVIDER'],
      message:
        'The console SMS provider cannot be used in production: no user would ever receive a code, ' +
        'and every OTP would be written to the log stream in plaintext. Implement a real SmsProvider ' +
        '(MSG91/Twilio) and add it to the SMS_PROVIDER enum before deploying.',
    });
  }

  if (env.NODE_ENV === 'production' && env.SWAGGER_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['SWAGGER_ENABLED'],
      message: 'Swagger must be disabled in production: it enumerates every endpoint and DTO.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/** Passed to `ConfigModule.forRoot({ validate })`. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchemaWithRules.safeParse(raw);

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
