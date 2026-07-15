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

  // --- Delivery (Phase 3) ---------------------------------------------------

  /** Used to build signed proof-of-delivery URLs. No trailing slash. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  /**
   * `local` writes delivery photos to disk. Dev only — REFUSED in production (see the
   * superRefine below), where the files would vanish with the pod and there would be no
   * replication, no lifecycle policy and no way to answer a delivery dispute.
   */
  STORAGE_PROVIDER: z.enum(['local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),

  /** Proof photos show the inside of a customer's doorway. Keep the window short. */
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /** A phone camera JPEG. Anything larger is a mistake or an attack. */
  DELIVERY_PHOTO_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),

  /**
   * When the nightly planner runs, as a cron expression, in the API's timezone.
   * 21:00 by default: late enough that the day's subscription changes have settled,
   * early enough that ops can look at the unassigned list before the 5am round.
   */
  DELIVERY_PLANNER_CRON: z.string().default('0 21 * * *'),

  /** Set false in tests and in any replica that must not run background jobs. */
  DELIVERY_PLANNER_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  // --- Wallet maintenance (Phase 5 hardening) -------------------------------

  /**
   * Replays every wallet's ledger and alerts on a mismatch.
   *
   * 02:00 by default — quiet, and any overnight discrepancy is on someone's desk before
   * the morning delivery round. Nobody thinks to ask about the wallet that is quietly
   * wrong, so something has to ask on their behalf.
   */
  WALLET_RECONCILE_CRON: z.string().default('0 2 * * *'),

  WALLET_MAINTENANCE_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * How long an idempotency key is kept. Must comfortably exceed how long any client will
   * keep retrying; a delivery partner's phone gives up long before 24h.
   */
  IDEMPOTENCY_RETENTION_HOURS: z.coerce.number().int().positive().default(24),

  // --- Recycling & batching (Phase 5) ---------------------------------------

  /** Groups completed pickups into collection batches, ready for dispatch to a mill. */
  BATCHING_CRON: z.string().default('0 4 * * *'),

  BATCHING_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * A batch is not worth dispatching below this. A truck to a mill costs the same whether
   * it carries 50 kg or 500 kg, so tiny batches destroy the unit economics of the whole
   * circular model — and the paper keeps just as well in the warehouse.
   */
  BATCH_MIN_WEIGHT_GRAMS: z.coerce.number().int().positive().default(50_000), // 50 kg

  /**
   * Weighbridge variance we accept without flagging.
   *
   * Paper genuinely loses moisture in transit, and a weighbridge has its own tolerance. A
   * few percent is physics; a large gap is spillage, theft, or a mis-keyed number — and
   * the difference between those two is exactly what this threshold exists to draw.
   */
  WEIGHBRIDGE_TOLERANCE_PERCENT: z.coerce.number().min(0).max(100).default(5),
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

  if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PROVIDER'],
      message:
        'Local disk storage cannot be used in production: proof-of-delivery photos would vanish ' +
        'with the pod, leaving no way to settle a delivery dispute. Implement an S3-compatible ' +
        'StorageProvider and add it to the STORAGE_PROVIDER enum before deploying.',
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
