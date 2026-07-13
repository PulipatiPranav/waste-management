/**
 * Generates the numeric OTP.
 *
 * A port so tests can pin the code to a known value, and — more importantly — so the
 * implementation is forced to be a single, reviewable place. `Math.random()` is
 * seeded and predictable; an OTP generated with it is guessable from prior codes.
 * The real implementation uses `crypto.randomInt`.
 */
export interface OtpCodeGenerator {
  generate(length: number): string;
}

export const OTP_CODE_GENERATOR = Symbol('OTP_CODE_GENERATOR');
