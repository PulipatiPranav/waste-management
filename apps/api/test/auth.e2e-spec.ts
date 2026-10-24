import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type ApiErrorResponse } from '@cpe/shared-types';
import { Role as PrismaRole } from '@prisma/client';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { ROLES } from '@/modules/auth/domain/value-objects/role';
import { SECRET_HASHER, type SecretHasher } from '@/modules/auth/domain/ports/hasher.port';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

/**
 * The real application against real Postgres and Redis.
 *
 * `pnpm dev:infra` locally; CI supplies both as service containers.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let hasher: SecretHasher;

  /** Unique per run so repeated local runs do not collide on the phone unique index. */
  const suffix = String(Date.now()).slice(-6);
  const phoneFor = (n: number) => `+9199${suffix}${String(n).padStart(2, '0')}`;

  /**
   * Captures the SMS the user would have received.
   *
   * This is the ONLY way the test can learn the code, and that is the point: the
   * plaintext is not persisted, not returned by the API and not logged, so the only
   * seam that has it is the SMS boundary — the same one a real user reads. Overriding
   * the port here is exactly what the port exists for.
   */
  const outbox: { to: string; body: string }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        send: (command: { to: string; body: string }) => {
          outbox.push(command);
          return Promise.resolve();
        },
      })
      .compile();

    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    hasher = app.get<SecretHasher>(SECRET_HASHER);

    await app.init();
  });

  beforeEach(async () => {
    // Rate limit counters are the one piece of state that leaks between tests and
    // would otherwise make them order-dependent (and mysteriously flaky in CI).
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { phone: { contains: suffix } } } });
    await prisma.otpChallenge.deleteMany({ where: { phone: { contains: suffix } } });
    await prisma.address.deleteMany({ where: { user: { phone: { contains: suffix } } } });
    await prisma.user.deleteMany({ where: { phone: { contains: suffix } } });
    await app.close();
  });

  // --- helpers ---------------------------------------------------------------

  /**
   * `X-Forwarded-For` is authoritative here because configureApp sets `trust proxy: 1`.
   * It lets a test give each caller a distinct source IP, which is the only way to
   * exercise the per-PHONE budget without the per-IP budget firing first.
   */
  const requestOtp = (phone: string, ip = '203.0.113.1') =>
    request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', ip)
      .send({ phone });

  /** The most recent code actually sent to this number. */
  const codeSentTo = (phone: string): string => {
    const message = [...outbox].reverse().find((sent) => sent.to === phone);

    if (message === undefined) throw new Error(`No SMS was sent to ${phone}`);

    const match = /\b(\d{6})\b/.exec(message.body);
    if (match?.[1] === undefined) throw new Error(`No code in the SMS body: ${message.body}`);

    return match[1];
  };

  const login = async (phone: string) => {
    await requestOtp(phone).expect(200);
    const code = codeSentTo(phone);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code })
      .expect(200);

    return response.body as {
      accessToken: string;
      refreshToken: string;
      isNewUser: boolean;
    };
  };

  // --- tests -----------------------------------------------------------------

  describe('the role enum stays in sync with the database', () => {
    it('domain ROLES matches the Prisma enum exactly', () => {
      // The domain cannot import @prisma/client (ESLint forbids it), so the two
      // definitions could silently diverge. A role added to the schema but not to the
      // domain would be un-guardable: @Roles() could never name it.
      expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort());
    });
  });

  describe('OTP request', () => {
    it('normalises a bare 10-digit number to E.164', async () => {
      const local = `99${suffix}10`;

      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: local })
        .expect(200);

      const challenge = await prisma.otpChallenge.findFirst({
        where: { phone: `+91${local}` },
      });

      expect(challenge).not.toBeNull();
    });

    it('never stores the code in plaintext', async () => {
      const phone = phoneFor(11);
      await requestOtp(phone).expect(200);
      const code = codeSentTo(phone);

      const challenge = await prisma.otpChallenge.findFirstOrThrow({ where: { phone } });

      expect(challenge.codeHash).toContain('$argon2id$');
      expect(challenge.codeHash).not.toContain(code);
    });

    it('rejects a malformed number with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ phone: 'not-a-phone' })
        .expect(400);
    });

    it('answers identically for a registered and an unregistered number', async () => {
      const known = phoneFor(12);
      await login(known);

      const unknown = phoneFor(13);

      const a = await requestOtp(known).expect(200);
      const b = await requestOtp(unknown).expect(200);

      // Any difference here — status, body, even wording — is a "is this person a
      // customer?" oracle for anyone with a phone book.
      expect(a.body).toEqual(b.body);
    });
  });

  describe('OTP verification', () => {
    it('registers a new user and returns a session', async () => {
      const session = await login(phoneFor(20));

      expect(session.isNewUser).toBe(true);
      expect(session.accessToken).toBeTruthy();
      expect(session.refreshToken).toBeTruthy();
    });

    it('logs an existing user back in without creating a duplicate', async () => {
      const phone = phoneFor(21);
      await login(phone);
      const second = await login(phone);

      expect(second.isNewUser).toBe(false);
      expect(await prisma.user.count({ where: { phone } })).toBe(1);
    });

    it('rejects a wrong code with 401 and does not leak why', async () => {
      const phone = phoneFor(22);
      await requestOtp(phone).expect(200);

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code: '000000' })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'INVALID_OTP' });
    });

    it('refuses to reuse a code (single use)', async () => {
      const phone = phoneFor(23);
      await requestOtp(phone).expect(200);
      const code = codeSentTo(phone);

      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code })
        .expect(401);
    });

    it('kills the challenge after too many wrong attempts', async () => {
      const phone = phoneFor(24);
      await requestOtp(phone).expect(200);
      const code = codeSentTo(phone);

      for (let i = 0; i < 5; i += 1) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/otp/verify')
          .send({ phone, code: '000000' })
          .expect(401);
      }

      // Even the correct code is now refused.
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code })
        .expect(401);

      expect(response.body).toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });
    });

    it('invalidates the previous code when a new one is requested', async () => {
      const phone = phoneFor(25);
      await requestOtp(phone).expect(200);
      const first = codeSentTo(phone);

      await requestOtp(phone).expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ phone, code: first })
        .expect(401);
    });
  });

  describe('protected endpoints', () => {
    it('rejects a request with no token', async () => {
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });

    it('rejects a garbage token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });

    it('accepts a valid token and never returns the password hash', async () => {
      const { accessToken } = await login(phoneFor(30));

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({ role: 'CUSTOMER' });
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('rejects the token of a user suspended after it was issued', async () => {
      const phone = phoneFor(31);
      const { accessToken } = await login(phone);

      await prisma.user.update({ where: { phone }, data: { isActive: false } });

      // The token is still cryptographically valid and unexpired. Suspension must bite
      // anyway — that is why the guard re-reads the user on every request.
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('role guard', () => {
    it('forbids a CUSTOMER from a staff-only endpoint', async () => {
      const { accessToken } = await login(phoneFor(40));
      const me = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/users/${(me.body as { id: string }).id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows OPS_STAFF through the same endpoint', async () => {
      const staffPhone = phoneFor(41);
      const { accessToken } = await login(staffPhone);
      await prisma.user.update({ where: { phone: staffPhone }, data: { role: 'OPS_STAFF' } });

      const target = phoneFor(42);
      await login(target);
      const targetUser = await prisma.user.findUniqueOrThrow({ where: { phone: target } });

      // The role is re-read from the DB by the guard, so the promotion takes effect
      // immediately — no new token needed.
      await request(app.getHttpServer())
        .get(`/api/v1/users/${targetUser.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('lets staff, and only staff, look a user up by phone', async () => {
      const customer = await login(phoneFor(43));
      const target = phoneFor(44);
      await login(target);

      await request(app.getHttpServer())
        .get('/api/v1/users/by-phone')
        .query({ phone: target })
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(403);

      const staffPhone = phoneFor(45);
      const staff = await login(staffPhone);
      await prisma.user.update({ where: { phone: staffPhone }, data: { role: 'OPS_STAFF' } });

      const found = await request(app.getHttpServer())
        .get('/api/v1/users/by-phone')
        .query({ phone: target })
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .expect(200);
      expect(found.body).toMatchObject({ phone: target });

      await request(app.getHttpServer())
        .get('/api/v1/users/by-phone')
        .query({ phone: phoneFor(46) })
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .expect(404);
    });
  });

  describe('staff password login', () => {
    it('signs in with argon2 credentials and rejects a wrong password identically to an unknown email', async () => {
      const phone = phoneFor(50);
      const email = `ops${suffix}@example.com`;
      const password = 'correct horse battery staple';

      await login(phone);
      await prisma.user.update({
        where: { phone },
        data: { email, role: 'OPS_STAFF', passwordHash: await hasher.hash(password) },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email, password })
        .expect(200);

      const wrongPassword = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email, password: 'wrong password here' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email: `nobody${suffix}@example.com`, password })
        .expect(401);

      // Identical bodies: no staff-email enumeration.
      const wrong = wrongPassword.body as ApiErrorResponse;
      const unknown = unknownEmail.body as ApiErrorResponse;

      expect(wrong.code).toBe(unknown.code);
      expect(wrong.message).toBe(unknown.message);
    });

    it('refuses a CUSTOMER even with a valid password on the row', async () => {
      const phone = phoneFor(51);
      const email = `cust${suffix}@example.com`;
      const password = 'correct horse battery staple';

      await login(phone);
      await prisma.user.update({
        where: { phone },
        data: { email, passwordHash: await hasher.hash(password) },
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/staff/login')
        .send({ email, password })
        .expect(401);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the token and revokes the old one', async () => {
      const { refreshToken } = await login(phoneFor(60));

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const next = (rotated.body as { refreshToken: string }).refreshToken;
      expect(next).not.toBe(refreshToken);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: next })
        .expect(200);
    });

    it('revokes the whole family when a spent token is replayed', async () => {
      const { refreshToken } = await login(phoneFor(61));

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      const current = (rotated.body as { refreshToken: string }).refreshToken;

      // An attacker replays the stolen, already-rotated token.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // The legitimate user's live token is now dead too: we cannot tell victim from
      // thief, so both are forced back through OTP login, which only the victim can pass.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: current })
        .expect(401);
    });

    it('rejects an unknown refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'never-issued-by-us' })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and is idempotent', async () => {
      const { refreshToken } = await login(phoneFor(70));

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      // A retry after a flaky network must not error.
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 with a Retry-After header once the OTP budget is spent', async () => {
      const phone = phoneFor(80);

      const statuses: number[] = [];
      let retryAfter: string | undefined;

      for (let i = 0; i < 8; i += 1) {
        const response = await requestOtp(phone);
        statuses.push(response.status);

        if (response.status === 429 && retryAfter === undefined) {
          retryAfter = response.headers['retry-after'];
        }
      }

      // The budget is real and it bites. Both layers (the coarse throttler and the
      // per-phone Redis budget) are Redis-backed, so this holds across replicas too —
      // with the library's default in-memory store it would not.
      expect(statuses).toContain(429);
      expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(5);

      // A 429 without Retry-After just tells the client to spin.
      expect(retryAfter).toBeDefined();
    });

    it('does not let one phone number burn another number’s budget', async () => {
      const attacker = phoneFor(81);
      const bystander = phoneFor(82);

      // Distinct source IPs, so this exercises the per-PHONE budget rather than the
      // per-IP one.
      for (let i = 0; i < 7; i += 1) await requestOtp(attacker, '203.0.113.50');

      // A limiter keyed too coarsely would now be denying service to every legitimate
      // customer — which is itself the attack.
      await requestOtp(bystander, '203.0.113.51').expect(200);
    });

    it('blocks a single phone number even when the attacker rotates IPs', async () => {
      const victim = phoneFor(83);

      // The per-IP budget is useless against a botnet: each request comes from a fresh
      // address. Only the per-phone budget stops the victim being SMS-bombed (and stops
      // us paying for every one of those messages).
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const response = await requestOtp(victim, `198.51.100.${i + 1}`);
        statuses.push(response.status);
      }

      expect(statuses).toContain(429);
      expect(statuses.filter((status) => status === 200).length).toBeLessThanOrEqual(5);
    });
  });

  describe('address ownership (IDOR)', () => {
    const addressBody = {
      label: 'Home',
      line1: 'Flat 402, Prestige Apartments',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    };

    it('scopes every operation to the owner, returning 404 (not 403) to everyone else', async () => {
      const alice = await login(phoneFor(90));
      const bob = await login(phoneFor(91));

      const created = await request(app.getHttpServer())
        .post('/api/v1/addresses')
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send(addressBody)
        .expect(201);

      const id = (created.body as { id: string; isDefault: boolean }).id;
      expect((created.body as { isDefault: boolean }).isDefault).toBe(true);

      // 404 rather than 403 on purpose: a 403 would confirm the id is real, letting an
      // attacker enumerate valid address ids.
      for (const send of [
        () =>
          request(app.getHttpServer())
            .get(`/api/v1/addresses/${id}`)
            .set('Authorization', `Bearer ${bob.accessToken}`),
        () =>
          request(app.getHttpServer())
            .patch(`/api/v1/addresses/${id}`)
            .set('Authorization', `Bearer ${bob.accessToken}`)
            .send({ city: 'Hacked' }),
        () =>
          request(app.getHttpServer())
            .delete(`/api/v1/addresses/${id}`)
            .set('Authorization', `Bearer ${bob.accessToken}`),
      ]) {
        await send().expect(404);
      }

      // And Alice's address is untouched.
      const after = await request(app.getHttpServer())
        .get(`/api/v1/addresses/${id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .expect(200);

      expect((after.body as { city: string }).city).toBe('Bengaluru');
    });

    it('rejects an attempt to escalate role through the profile endpoint', async () => {
      const { accessToken } = await login(phoneFor(92));

      const response = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Priya', role: 'SUPER_ADMIN' })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });

      const me = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((me.body as { role: string }).role).toBe('CUSTOMER');
    });
  });
});
