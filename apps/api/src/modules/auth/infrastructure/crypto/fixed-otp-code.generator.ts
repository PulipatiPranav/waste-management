import { type OtpCodeGenerator } from '../../domain/ports/otp-code-generator.port';

/**
 * Demo-only generator: every code is all zeros (`000000` at the default length).
 *
 * Wired in only when DEMO_MODE=true, which the env schema refuses in production. The rest
 * of the OTP flow is unchanged — the code is still hashed, expires, and is rate-limited.
 */
export class FixedOtpCodeGenerator implements OtpCodeGenerator {
  generate(length: number): string {
    return '0'.repeat(length);
  }
}
