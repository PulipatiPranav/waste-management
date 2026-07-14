import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { type Env } from '@/config/env.schema';
import { UsersModule } from '@/modules/users/users.module';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';
import { AUTH_CONFIG, type AuthConfig } from './application/auth.config';
import { SessionIssuerService } from './application/services/session-issuer.service';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshTokensUseCase } from './application/use-cases/refresh-tokens.use-case';
import { RequestOtpUseCase } from './application/use-cases/request-otp.use-case';
import { StaffLoginUseCase } from './application/use-cases/staff-login.use-case';
import { VerifyOtpUseCase } from './application/use-cases/verify-otp.use-case';
import { CLOCK } from './domain/ports/clock.port';
import { SECRET_HASHER, TOKEN_HASHER } from './domain/ports/hasher.port';
import { OTP_CHALLENGE_REPOSITORY } from './domain/ports/otp-challenge.repository';
import { OTP_CODE_GENERATOR } from './domain/ports/otp-code-generator.port';
import { RATE_LIMITER } from './domain/ports/rate-limiter.port';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token.repository';
import { SMS_PROVIDER } from './domain/ports/sms-provider.port';
import { TOKEN_ISSUER } from './domain/ports/token-issuer.port';
import { Argon2SecretHasher } from './infrastructure/crypto/argon2-secret.hasher';
import { CryptoOtpCodeGenerator } from './infrastructure/crypto/crypto-otp-code.generator';
import { JwtTokenIssuer } from './infrastructure/crypto/jwt-token.issuer';
import { Sha256TokenHasher } from './infrastructure/crypto/sha256-token.hasher';
import { PrismaOtpChallengeRepository } from './infrastructure/persistence/prisma-otp-challenge.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository';
import { RedisRateLimiter } from './infrastructure/rate-limit/redis-rate.limiter';
import { RedisThrottlerStorage } from './infrastructure/rate-limit/redis-throttler.storage';
import { ConsoleSmsProvider } from './infrastructure/sms/console-sms.provider';
import { SystemClock } from './infrastructure/system-clock';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';
import { RolesGuard } from './presentation/guards/roles.guard';

/**
 * Composition root for auth: the only file that knows both the ports and the adapters
 * behind them. Swapping ConsoleSmsProvider for an MSG91 one is a change here and
 * nowhere else — no use case is aware a provider changed.
 */
@Module({
  imports: [
    UsersModule,

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          // HS256 is the default, but state it: leaving `algorithms` unpinned on the
          // VERIFY side is the classic JWT footgun (an attacker presents `alg: none`
          // or an RS256/HS256 confusion token). @nestjs/jwt pins it from this value.
          algorithm: 'HS256',
          issuer: 'cpe-api',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'cpe-api',
        },
      }),
    }),

    // Coarse per-IP flood protection in front of everything: it rejects a burst before
    // any DB write, Argon2 hash or SMS spend. The per-phone/per-IP OTP *policy* is the
    // Redis limiter in the use case; this is the cheap outer net.
    //
    // Storage is explicitly Redis, not the library default — see RedisThrottlerStorage.
    ThrottlerModule.forRootAsync({
      // RedisService comes from the @Global RedisModule, so the storage can simply be
      // constructed here — no extra provider plumbing.
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],

  controllers: [AuthController],

  providers: [
    // --- Ports -> adapters --------------------------------------------------
    { provide: OTP_CHALLENGE_REPOSITORY, useClass: PrismaOtpChallengeRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: PrismaRefreshTokenRepository },
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
    { provide: SECRET_HASHER, useClass: Argon2SecretHasher },
    { provide: TOKEN_HASHER, useClass: Sha256TokenHasher },
    { provide: TOKEN_ISSUER, useClass: JwtTokenIssuer },
    { provide: OTP_CODE_GENERATOR, useClass: CryptoOtpCodeGenerator },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    { provide: CLOCK, useClass: SystemClock },

    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AuthConfig => ({
        otpTtlSeconds: config.get('OTP_TTL_SECONDS', { infer: true }),
        otpLength: config.get('OTP_LENGTH', { infer: true }),
        otpMaxAttempts: config.get('OTP_MAX_ATTEMPTS', { infer: true }),
        otpMaxRequestsPerPhone: config.get('OTP_MAX_REQUESTS_PER_PHONE', { infer: true }),
        otpPhoneWindowSeconds: config.get('OTP_PHONE_WINDOW_SECONDS', { infer: true }),
        otpMaxRequestsPerIp: config.get('OTP_MAX_REQUESTS_PER_IP', { infer: true }),
        otpIpWindowSeconds: config.get('OTP_IP_WINDOW_SECONDS', { infer: true }),
        accessTokenTtlSeconds: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
        refreshTokenTtlSeconds: config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true }),
      }),
    },

    // --- Application --------------------------------------------------------
    SessionIssuerService,
    RequestOtpUseCase,
    VerifyOtpUseCase,
    RefreshTokensUseCase,
    StaffLoginUseCase,
    LogoutUseCase,

    // --- Global guards ------------------------------------------------------
    //
    // Order is significant: Nest runs APP_GUARDs in declaration order, and RolesGuard
    // reads the user that JwtAuthGuard puts on the request. Registering them the other
    // way round would make every @Roles check see `undefined` and reject everyone.
    //
    // Registering these GLOBALLY (rather than per-controller) makes authentication the
    // default and `@Public()` the visible exception. The alternative fails open.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],

  // CLOCK is exported so other modules get testable time from the same port rather than
  // each reaching for `new Date()` — which is what makes the subscription date rules
  // (backdating, "paused from today") assertable without waiting for tomorrow.
  exports: [SECRET_HASHER, CLOCK],
})
export class AuthModule {}
