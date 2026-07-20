import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Job } from 'bullmq';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import {
  NOTIFICATION_DISPATCHER,
  type NotificationDispatcher,
} from '@/modules/notifications/domain/ports/notification-dispatcher.port';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '@/modules/notifications/domain/ports/notification.repository';
import { NOTIFICATION_MAX_ATTEMPTS } from '@/modules/notifications/domain/retry-policy';
import { NotificationWorker } from '@/modules/notifications/infrastructure/jobs/notifications.queue';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

/**
 * NOTIFICATIONS (e2e, real Postgres). Covers the customer-facing surface (register a device,
 * opt out of a category) and — deterministically, by driving the worker directly rather than
 * racing the queue — the three send outcomes that matter: delivered, transient-then-retried, and
 * permanently-failed-into-a-dead-letter (never silently dropped).
 */
describe('Notifications (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let dispatcher: NotificationDispatcher;
  let repo: NotificationRepository;
  let worker: NotificationWorker;

  const suffix = String(Date.now()).slice(-6);
  const outbox: { to: string; body: string }[] = [];
  const createdUserIds: string[] = [];

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
    dispatcher = app.get<NotificationDispatcher>(NOTIFICATION_DISPATCHER);
    repo = app.get<NotificationRepository>(NOTIFICATION_REPOSITORY);
    worker = app.get(NotificationWorker);
    await app.init();
  });

  afterAll(async () => {
    // device_tokens / notification_preferences / notifications all cascade on the user.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  let seq = 0;

  // A per-RUN unique client IP: the suffix varies each run, so the OTP per-IP rate limiter (a
  // 1-hour window) does not accumulate across back-to-back runs the way a fixed IP would.
  const ipFor = (n: number): string =>
    `10.${(Number(suffix) % 200) + 1}.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`;

  const login = async (): Promise<{ token: string; userId: string }> => {
    seq += 1;
    const ip = ipFor(seq);
    const localPhone = `95${suffix}${String(seq).padStart(2, '0')}`;
    const phone = `+91${localPhone}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', ip)
      .send({ phone: localPhone })
      .expect(200);

    const code = /\b(\d{6})\b/.exec(
      [...outbox].reverse().find((m) => m.to === phone)?.body ?? '',
    )?.[1];
    const session = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ phone: localPhone, code })
      .expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    createdUserIds.push(user.id);
    return { token: (session.body as { accessToken: string }).accessToken, userId: user.id };
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A minimal BullMQ Job stand-in — the worker only reads data, attemptsMade and opts.attempts. */
  const fakeJob = (notificationId: string, attemptsMade: number): Job<{ notificationId: string }> =>
    ({
      data: { notificationId },
      attemptsMade,
      opts: { attempts: NOTIFICATION_MAX_ATTEMPTS },
    }) as unknown as Job<{ notificationId: string }>;

  // --- Device registration --------------------------------------------------

  describe('device registration', () => {
    it('registers a device and is idempotent on the token', async () => {
      const user = await login();
      const token = `good-${suffix}-android`;

      await request(app.getHttpServer())
        .post('/api/v1/notifications/devices')
        .set(auth(user.token))
        .send({ token, platform: 'ANDROID' })
        .expect(201);

      // Re-registering the same token refreshes rather than duplicating.
      await request(app.getHttpServer())
        .post('/api/v1/notifications/devices')
        .set(auth(user.token))
        .send({ token, platform: 'ANDROID' })
        .expect(201);

      const rows = await prisma.deviceToken.findMany({ where: { token } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.isActive).toBe(true);

      await request(app.getHttpServer())
        .post('/api/v1/notifications/devices/unregister')
        .set(auth(user.token))
        .send({ token })
        .expect(201);

      const after = await prisma.deviceToken.findUniqueOrThrow({ where: { token } });
      expect(after.isActive).toBe(false);
    });
  });

  // --- Preferences ----------------------------------------------------------

  describe('per-category opt-out', () => {
    it('is on by default and can be turned off for one category without affecting others', async () => {
      const user = await login();

      const initial = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set(auth(user.token))
        .expect(200);
      const prefs = initial.body as { category: string; enabled: boolean }[];
      expect(prefs).toHaveLength(6);
      expect(prefs.every((p) => p.enabled)).toBe(true);

      await request(app.getHttpServer())
        .post('/api/v1/notifications/preferences')
        .set(auth(user.token))
        .send({ category: 'SUBSCRIPTION_RENEWAL', enabled: false })
        .expect(201);

      const updated = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set(auth(user.token))
        .expect(200);
      const after = updated.body as { category: string; enabled: boolean }[];
      expect(after.find((p) => p.category === 'SUBSCRIPTION_RENEWAL')?.enabled).toBe(false);
      expect(after.find((p) => p.category === 'PICKUP_CASHBACK')?.enabled).toBe(true);
    });
  });

  // --- Dispatch respects preferences ---------------------------------------

  describe('dispatch honours the opt-out (filtering)', () => {
    it('does not create a notification for an opted-out category, but does for others', async () => {
      const user = await login();
      await repo.setPreference(user.userId, 'PICKUP_CASHBACK', false);

      await dispatcher.dispatch({
        userId: user.userId,
        category: 'PICKUP_CASHBACK',
        title: 'x',
        body: 'y',
      });
      await dispatcher.dispatch({
        userId: user.userId,
        category: 'ORDER_STATUS',
        title: 'x',
        body: 'y',
      });

      const suppressed = await prisma.notification.findMany({
        where: { userId: user.userId, category: 'PICKUP_CASHBACK' },
      });
      const allowed = await prisma.notification.findMany({
        where: { userId: user.userId, category: 'ORDER_STATUS' },
      });
      expect(suppressed).toHaveLength(0);
      expect(allowed).toHaveLength(1);
    });
  });

  // --- Worker outcomes: sent, retry, dead-letter ---------------------------

  describe('send outcomes', () => {
    it('marks SENT when at least one device accepts the push', async () => {
      const user = await login();
      await repo.registerToken({
        userId: user.userId,
        token: `good-${suffix}-s`,
        platform: 'ANDROID',
      });
      const n = await repo.createQueued({
        userId: user.userId,
        category: 'ORDER_STATUS',
        title: 't',
        body: 'b',
        data: null,
      });

      const result = await worker.process(fakeJob(n.id, 0));
      expect(result.decision).toBe('SENT');
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe('SENT');
    });

    it('dead-letters (never drops) when every device token is permanently dead, and deactivates them', async () => {
      const user = await login();
      const deadToken = `dead-${suffix}-x`;
      await repo.registerToken({ userId: user.userId, token: deadToken, platform: 'ANDROID' });
      const n = await repo.createQueued({
        userId: user.userId,
        category: 'DELIVERY_COMPLETED',
        title: 't',
        body: 'b',
        data: null,
      });

      const result = await worker.process(fakeJob(n.id, 0));
      expect(result.decision).toBe('DEAD_LETTER');

      const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe('FAILED');
      expect(row.lastError).toBeTruthy();

      // The dead token was deactivated so we stop pushing to it.
      const token = await prisma.deviceToken.findUniqueOrThrow({ where: { token: deadToken } });
      expect(token.isActive).toBe(false);
    });

    it('a transient failure THROWS (so BullMQ retries), and the final failure dead-letters', async () => {
      const user = await login();
      await repo.registerToken({
        userId: user.userId,
        token: `flaky-${suffix}-x`,
        platform: 'ANDROID',
      });
      const n = await repo.createQueued({
        userId: user.userId,
        category: 'WITHDRAWAL_UPDATE',
        title: 't',
        body: 'b',
        data: null,
      });

      // A non-final attempt on a transient failure must throw so the queue reschedules it.
      await expect(worker.process(fakeJob(n.id, 0))).rejects.toThrow();
      // Still QUEUED between attempts — not yet a dead-letter.
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe(
        'QUEUED',
      );

      // When BullMQ exhausts the attempts, the failed handler writes the dead-letter.
      await worker.onFailed(fakeJob(n.id, NOTIFICATION_MAX_ATTEMPTS), new Error('provider 503'));
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe('FAILED');
      expect(row.lastError).toContain('503');
    });

    it('does not dead-letter on a non-final failure', async () => {
      const user = await login();
      const n = await repo.createQueued({
        userId: user.userId,
        category: 'ORDER_STATUS',
        title: 't',
        body: 'b',
        data: null,
      });
      // attemptsMade below the max: the failed handler must leave it QUEUED for the next retry.
      await worker.onFailed(fakeJob(n.id, 1), new Error('blip'));
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe(
        'QUEUED',
      );
    });
  });
});
