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

  // --- Observability (Phase 14) ---------------------------------------------

  /** Service name stamped on traces, metrics and errors so multiple services are distinguishable. */
  OTEL_SERVICE_NAME: z.string().default('cpe-api'),

  /**
   * Turns OpenTelemetry tracing on. Off by default so local dev and tests do not need a
   * collector; the deploy sets it true. Read in `instrumentation.ts` BEFORE the Nest app —
   * hence `process.env` there, not this schema (the config module has not booted yet).
   */
  OTEL_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  /** OTLP/HTTP collector endpoint, e.g. `http://otel-collector:4318`. Required when OTEL_ENABLED. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  /** Prometheus scrape endpoint (`GET /metrics`) is served only when true. */
  METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * Sentry DSN for the API. Empty = Sentry disabled (local/tests). Read in `instrumentation.ts`
   * from `process.env` for the same boot-ordering reason as OTEL_ENABLED.
   */
  SENTRY_DSN: z.string().optional(),

  /** Fraction of transactions traced by Sentry performance monitoring, 0..1. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

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
   * `console` prints the OTP to the log for local development. `msg91` sends a real SMS
   * via MSG91's Flow API. `console` is REFUSED in production (see the superRefine below)
   * — shipping it would mean no user ever receives a code, and every code is printed
   * into the log stream.
   */
  SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),

  /** MSG91 auth key (dashboard → API → Auth Key). Required when SMS_PROVIDER=msg91. */
  MSG91_AUTH_KEY: z.string().optional(),

  /** The 6-character DLT-registered sender id, e.g. `ANVAYA`. */
  MSG91_SENDER_ID: z.string().optional(),

  /** The MSG91 Flow id for the OTP template (DLT-registered). */
  MSG91_DLT_TEMPLATE_ID: z.string().optional(),

  // --- Delivery (Phase 3) ---------------------------------------------------

  /** Used to build signed proof-of-delivery URLs. No trailing slash. */
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  /**
   * `local` writes delivery photos to disk — dev only, REFUSED in production (see the
   * superRefine below), where the files would vanish with the pod and there would be no
   * replication, no lifecycle policy and no way to answer a delivery dispute. `s3` writes
   * to any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, ...).
   */
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.storage'),

  /** S3-compatible endpoint. For Cloudflare R2: `https://<account-id>.r2.cloudflarestorage.com`. */
  S3_ENDPOINT: z.string().url().optional(),

  /** R2 has no real regions; `auto` is correct there. Set a real region for AWS S3. */
  S3_REGION: z.string().default('auto'),

  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

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

  // --- Sustainability impact (Phase 6) --------------------------------------

  /**
   * Recomputes the impact cache. 05:00 — after batching (04:00), so it sees the day's freshly
   * confirmed batches. Impact is read far more than it changes, so this runs nightly rather
   * than on every dashboard load.
   */
  IMPACT_AGGREGATION_CRON: z.string().default('0 5 * * *'),

  IMPACT_AGGREGATION_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  // --- Marketplace payments (Phase 8) ---------------------------------------

  /**
   * Which payment gateway backs the card/UPI leg of a marketplace order.
   *
   * `fake` is a deterministic in-process gateway for local dev and tests: it mints
   * predictable order ids and never calls a network, but signs and verifies webhooks with
   * the SAME real HMAC scheme as Razorpay, so the signature path is exercised for real. It
   * is REFUSED in production (see the superRefine) — shipping it would mean orders that
   * "confirm" without any money ever moving.
   */
  PAYMENT_GATEWAY_PROVIDER: z.enum(['fake', 'razorpay']).default('fake'),

  PAYMENT_CURRENCY: z.string().length(3).default('INR'),

  /**
   * The webhook signing secret. HMAC-SHA256 over the raw request body is compared against
   * this — it is the ONLY thing standing between our confirmation flow and anyone on the
   * internet who finds the webhook URL. No production default, deliberately: a shared
   * fallback secret is a forged-webhook-away from confirming orders nobody paid for.
   */
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('whsec_dev_only_change_me_please'),

  /** Razorpay API credentials. Required only when PAYMENT_GATEWAY_PROVIDER=razorpay. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  // --- Push notifications (Phase 10) ----------------------------------------

  /**
   * Which push backend to use. `fcm` routes Android via Firebase and iOS via APNs behind one
   * interface; `fake` is a deterministic in-process provider for dev and tests that records
   * sends and can be told to fail on command (to exercise retry/backoff and dead-lettering)
   * without a device or a network. `fake` is REFUSED in production — a notification that
   * "sends" nowhere is worse than one that errors loudly.
   */
  PUSH_PROVIDER: z.enum(['fake', 'fcm']).default('fake'),

  /** Whether the notification queue's workers/schedulers run in this process. Off in tests. */
  NOTIFICATIONS_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),

  /** Firebase service-account JSON (as a string) for FCM. Required when PUSH_PROVIDER=fcm. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),

  /** APNs credentials for iOS. Required when PUSH_PROVIDER=fcm and iOS devices are in play. */
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),

  /**
   * When the renewal-reminder and pickup-reminder scans run, as cron expressions. 09:00 and
   * 08:00 by default — morning, when a customer can act on the reminder the same day.
   */
  NOTIFICATION_RENEWAL_REMINDER_CRON: z.string().default('0 9 * * *'),
  NOTIFICATION_PICKUP_REMINDER_CRON: z.string().default('0 8 * * *'),

  /** How many days before a subscription's next billing to send the renewal reminder. */
  RENEWAL_REMINDER_LEAD_DAYS: z.coerce.number().int().positive().max(30).default(3),
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
        'and every OTP would be written to the log stream in plaintext. Set SMS_PROVIDER=msg91 (with ' +
        'MSG91_AUTH_KEY/SENDER_ID/DLT_TEMPLATE_ID) before deploying.',
    });
  }

  if (env.SMS_PROVIDER === 'msg91' && env.MSG91_AUTH_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MSG91_AUTH_KEY'],
      message: 'MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91.',
    });
  }

  if (env.SMS_PROVIDER === 'msg91' && env.MSG91_SENDER_ID === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MSG91_SENDER_ID'],
      message: 'MSG91_SENDER_ID is required when SMS_PROVIDER=msg91.',
    });
  }

  if (env.SMS_PROVIDER === 'msg91' && env.MSG91_DLT_TEMPLATE_ID === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MSG91_DLT_TEMPLATE_ID'],
      message: 'MSG91_DLT_TEMPLATE_ID is required when SMS_PROVIDER=msg91.',
    });
  }

  if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_PROVIDER'],
      message:
        'Local disk storage cannot be used in production: proof-of-delivery photos would vanish ' +
        'with the pod, leaving no way to settle a delivery dispute. Set STORAGE_PROVIDER=s3 (with ' +
        'S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY) before deploying.',
    });
  }

  if (env.STORAGE_PROVIDER === 's3') {
    const required = [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const;
    for (const key of required) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when STORAGE_PROVIDER=s3.`,
        });
      }
    }
  }

  if (env.OTEL_ENABLED && env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
      message:
        'OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED=true: tracing is on but there is ' +
        'nowhere to export spans to. Point it at the collector, e.g. http://otel-collector:4318.',
    });
  }

  if (env.NODE_ENV === 'production' && env.SWAGGER_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['SWAGGER_ENABLED'],
      message: 'Swagger must be disabled in production: it enumerates every endpoint and DTO.',
    });
  }

  if (env.NODE_ENV === 'production' && env.PAYMENT_GATEWAY_PROVIDER === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_GATEWAY_PROVIDER'],
      message:
        'The fake payment gateway cannot be used in production: orders would confirm without any ' +
        'money moving. Set PAYMENT_GATEWAY_PROVIDER=razorpay and provide the Razorpay credentials.',
    });
  }

  if (env.NODE_ENV === 'production' && env.PUSH_PROVIDER === 'fake') {
    ctx.addIssue({
      code: 'custom',
      path: ['PUSH_PROVIDER'],
      message:
        'The fake push provider cannot be used in production: notifications would send nowhere. ' +
        'Set PUSH_PROVIDER=fcm and provide FCM_SERVICE_ACCOUNT_JSON (and APNs credentials for iOS).',
    });
  }

  if (env.PUSH_PROVIDER === 'fcm' && env.FCM_SERVICE_ACCOUNT_JSON === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['FCM_SERVICE_ACCOUNT_JSON'],
      message: 'FCM_SERVICE_ACCOUNT_JSON is required when PUSH_PROVIDER=fcm.',
    });
  }

  if (
    env.PAYMENT_GATEWAY_PROVIDER === 'razorpay' &&
    (env.RAZORPAY_KEY_ID === undefined || env.RAZORPAY_KEY_SECRET === undefined)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['RAZORPAY_KEY_ID'],
      message:
        'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_GATEWAY_PROVIDER=razorpay.',
    });
  }

  if (
    env.NODE_ENV === 'production' &&
    env.PAYMENT_WEBHOOK_SECRET === 'whsec_dev_only_change_me_please'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYMENT_WEBHOOK_SECRET'],
      message:
        'The default PAYMENT_WEBHOOK_SECRET cannot be used in production: a known signing secret ' +
        'lets anyone forge a webhook and confirm unpaid orders. Set a real one from the gateway dashboard.',
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
