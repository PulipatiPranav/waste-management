/**
 * Redaction for audit metadata. Pure, because "did we strip the password before writing it to a
 * table support can read?" is exactly the kind of thing that must be provable without a database.
 *
 * An audit log records what a staff member did. It must NOT become a second copy of every secret
 * that passed through a request body — a reviewable table full of plaintext passwords, OTP codes,
 * refresh tokens and bank details is a bigger liability than the trail is an asset. So any key
 * whose name looks sensitive has its value replaced with a marker, recursively, before anything is
 * persisted. We redact on the key name (not the value) deliberately: it is the one signal that is
 * stable regardless of the value's shape.
 */

const REDACTED = '[REDACTED]';

/** Substrings that mark a key as sensitive. Matched case-insensitively. */
const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'otp',
  'code',
  'signature',
  'authorization',
  'auth',
  'pin',
  'cvv',
  'card',
  'account',
  'ifsc',
  'ssn',
  'aadhaar',
  'apikey',
  'key',
] as const;

/** Caps how deep and how large a persisted payload can get — an audit row is a summary, not a dump. */
const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

/**
 * Returns a deep copy of `value` with every sensitive field replaced by `[REDACTED]`, strings
 * truncated, and structures capped in depth. Never mutates the input, never throws — a value it
 * cannot represent (a function, a cycle beyond the depth cap) becomes a safe placeholder.
 */
export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactAuditPayload(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactAuditPayload(child, depth + 1);
    }
    return out;
  }

  // Functions, symbols, bigints — not something a JSON audit row should carry verbatim.
  return typeof value === 'bigint' ? value.toString() : '[UNSERIALISABLE]';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Picks the primary target id from a set of route params. Prefers an explicit `id`, then any
 * param whose value is a UUID (an order id, a user id), so the audit row can be filtered by
 * "everything done to this entity" without the interceptor knowing each route's param name.
 */
export function pickTargetId(params: Record<string, string>): string | null {
  if (typeof params.id === 'string' && UUID_RE.test(params.id)) {
    return params.id;
  }
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && UUID_RE.test(value)) {
      return value;
    }
  }
  return null;
}
