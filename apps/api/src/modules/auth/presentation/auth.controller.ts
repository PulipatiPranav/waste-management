import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { type Request } from 'express';

import { LogoutUseCase } from '../application/use-cases/logout.use-case';
import { RefreshTokensUseCase } from '../application/use-cases/refresh-tokens.use-case';
import { RequestOtpUseCase } from '../application/use-cases/request-otp.use-case';
import { StaffLoginUseCase } from '../application/use-cases/staff-login.use-case';
import { VerifyOtpUseCase } from '../application/use-cases/verify-otp.use-case';
import { type SessionContext } from '../application/services/session-issuer.service';
import { Public } from './decorators/public.decorator';
import {
  OtpSessionResponseDto,
  RefreshTokenDto,
  RequestOtpDto,
  RequestOtpResponseDto,
  SessionResponseDto,
  StaffLoginDto,
  VerifyOtpDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly requestOtp: RequestOtpUseCase,
    private readonly verifyOtp: VerifyOtpUseCase,
    private readonly refreshTokens: RefreshTokensUseCase,
    private readonly staffLogin: StaffLoginUseCase,
    private readonly logout: LogoutUseCase,
  ) {}

  /**
   * Two layers of rate limiting sit on this endpoint, and they are not redundant:
   *
   *  - `@Throttle` (this decorator) is a coarse per-IP guard that rejects a flood
   *    BEFORE any work — no DB write, no Argon2 hash, no SMS.
   *  - The use case's Redis limiter is the per-phone AND per-IP budget that actually
   *    enforces the policy, correctly, across replicas.
   *
   * The throttler alone would be insufficient (its default store is per-process, so N
   * pods means N× the budget) and the Redis limiter alone would still let an attacker
   * make us do real work per request.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a login OTP',
    description:
      'Always returns 200 for a well-formed number, whether or not it is registered — ' +
      'a different response would turn this into a "is this person a customer?" oracle.',
  })
  @ApiOkResponse({ type: RequestOtpResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Per-phone or per-IP budget exhausted.' })
  async request(
    @Body() dto: RequestOtpDto,
    @Req() request: Request,
  ): Promise<RequestOtpResponseDto> {
    const result = await this.requestOtp.execute({
      phone: dto.phone,
      ip: this.ipOf(request),
    });

    return {
      expiresInSeconds: result.expiresInSeconds,
      message: 'If that number is valid, a code has been sent.',
    };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify an OTP and start a session',
    description: 'Registers the user if the phone number is new. Login and sign-up are one step.',
  })
  @ApiOkResponse({ type: OtpSessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Code is wrong, expired, or already used.' })
  verify(@Body() dto: VerifyOtpDto, @Req() request: Request): Promise<OtpSessionResponseDto> {
    return this.verifyOtp.execute({
      phone: dto.phone,
      code: dto.code,
      context: this.sessionContext(request),
    });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email + password login for staff',
    description: 'OPS_STAFF and SUPER_ADMIN only. Customers have no password and cannot use this.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Incorrect email or password.' })
  login(@Body() dto: StaffLoginDto, @Req() request: Request): Promise<SessionResponseDto> {
    return this.staffLogin.execute({
      email: dto.email,
      password: dto.password,
      context: this.sessionContext(request),
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new session',
    description:
      'The presented token is revoked and replaced (rotation). Presenting an ALREADY-revoked ' +
      'token is treated as theft: the entire token family is revoked and the user must log in again.',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token invalid, expired, or revoked.' })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request): Promise<SessionResponseDto> {
    return this.refreshTokens.execute({
      refreshToken: dto.refreshToken,
      context: this.sessionContext(request),
    });
  }

  /**
   * Public, and takes the refresh token in the body rather than reading the caller's
   * access token. Logging out must work even when the access token has already
   * expired — otherwise the user is stuck "logged in" until it does.
   *
   * Idempotent and silent on an unknown token: a retry after a flaky network must not
   * error, and probing here must not reveal which tokens exist.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token family' })
  async signOut(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logout.execute({ refreshToken: dto.refreshToken });
  }

  private sessionContext(request: Request): SessionContext {
    return {
      userAgent: request.header('user-agent') ?? null,
      ip: this.ipOf(request),
    };
  }

  /**
   * `request.ip` is only trustworthy because `trust proxy` is configured explicitly in
   * configureApp(). Without that, Express reports the load balancer's address for every
   * request and the per-IP limit becomes one global bucket — trivially exhausted by one
   * attacker, locking out every real user behind the same proxy.
   */
  private ipOf(request: Request): string | null {
    return request.ip ?? null;
  }
}
