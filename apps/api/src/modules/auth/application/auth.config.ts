/**
 * Auth tuning, injected rather than read from `process.env` inside a use case.
 *
 * Keeping the use cases free of ConfigService is what lets a test say "OTP TTL is
 * 1 second" and assert expiry without touching the environment.
 */
export interface AuthConfig {
  otpTtlSeconds: number;
  otpLength: number;
  otpMaxAttempts: number;

  otpMaxRequestsPerPhone: number;
  otpPhoneWindowSeconds: number;
  otpMaxRequestsPerIp: number;
  otpIpWindowSeconds: number;

  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
