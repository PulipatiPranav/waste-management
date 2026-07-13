/**
 * Slow, salted hashing for low-entropy secrets: passwords and OTP codes.
 *
 * Backed by Argon2id (the brief mandates argon2 over bcrypt). Both call sites need
 * the slowness for the same reason — a 6-digit OTP has only 10^6 possibilities and a
 * human password rather fewer than that in practice, so if the table leaks, a fast
 * hash means the whole column is cracked in seconds.
 */
export interface SecretHasher {
  hash(plaintext: string): Promise<string>;

  /** MUST be constant-time with respect to the secret. */
  verify(hash: string, plaintext: string): Promise<boolean>;
}

export const SECRET_HASHER = Symbol('SECRET_HASHER');

/**
 * Fast hashing for HIGH-entropy secrets: refresh tokens.
 *
 * Separate port from SecretHasher on purpose, so the choice is explicit at each call
 * site rather than accidental. A refresh token is 256 bits of CSPRNG output — there
 * is no dictionary to grind, so Argon2 would buy nothing and cost ~100ms on every
 * single refresh request. SHA-256 is the right tool. Using this on a password would
 * be a serious bug, which is why it is named to make that obvious.
 */
export interface TokenHasher {
  hash(token: string): string;
}

export const TOKEN_HASHER = Symbol('TOKEN_HASHER');
