import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BillingCycle as PrismaBillingCycle,
  DeliveryFrequency as PrismaFrequency,
  Language as PrismaLanguage,
  SubscriptionStatus as PrismaStatus,
} from '@prisma/client';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { LANGUAGES } from '@/modules/catalog/domain/catalog.types';
import { SUBSCRIPTION_STATUSES } from '@/modules/subscriptions/domain/subscription-state-machine';
import { DELIVERY_FREQUENCIES } from '@/modules/subscriptions/domain/value-objects/delivery-frequency';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

const PINCODE = '560038';
const OTHER_PINCODE = '600020';
const PRICE = 450;

describe('Catalog & subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  const suffix = String(Date.now()).slice(-6);
  const outbox: { to: string; body: string }[] = [];

  let editionId: string;
  let publisherId: string;
  let newspaperId: string;

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

    await app.init();

    const publisher = await prisma.publisher.create({
      data: { name: `Test Press ${suffix}` },
    });
    publisherId = publisher.id;

    const newspaper = await prisma.newspaper.create({
      data: { publisherId, name: `Test Herald ${suffix}`, language: 'ENGLISH' },
    });
    newspaperId = newspaper.id;

    const edition = await prisma.newspaperEdition.create({
      data: {
        newspaperId,
        city: `Testville ${suffix}`,
        state: 'Karnataka',
        servicePincodes: [PINCODE],
        pricePerIssuePaise: PRICE,
      },
    });
    editionId = edition.id;
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await prisma.subscriptionPause.deleteMany({
      where: { subscription: { user: { phone: { contains: suffix } } } },
    });
    await prisma.subscription.deleteMany({ where: { user: { phone: { contains: suffix } } } });
    await prisma.newspaperEdition.deleteMany({ where: { newspaperId } });
    await prisma.newspaper.deleteMany({ where: { publisherId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    await prisma.address.deleteMany({ where: { user: { phone: { contains: suffix } } } });
    await prisma.refreshToken.deleteMany({ where: { user: { phone: { contains: suffix } } } });
    await prisma.otpChallenge.deleteMany({ where: { phone: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { phone: { contains: suffix } } });
    await app.close();
  });

  // --- helpers ---------------------------------------------------------------

  let seq = 0;

  /** A fresh, logged-in customer with one address in `pincode`. */
  const customer = async (pincode = PINCODE) => {
    seq += 1;
    const phone = `+9198${suffix}${String(seq).padStart(2, '0')}`;
    const ip = `203.0.113.${seq}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', ip)
      .send({ phone })
      .expect(200);

    const message = [...outbox].reverse().find((sent) => sent.to === phone);
    const code = /\b(\d{6})\b/.exec(message?.body ?? '')?.[1] ?? '';

    const session = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code })
      .expect(200);

    const token = (session.body as { accessToken: string }).accessToken;

    const address = await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        line1: 'Flat 402',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode,
      })
      .expect(201);

    return { token, phone, addressId: (address.body as { id: string }).id };
  };

  const staff = async () => {
    const { token, phone } = await customer();
    await prisma.user.update({ where: { phone }, data: { role: 'OPS_STAFF' } });
    return token;
  };

  const subscribe = (token: string, addressId: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        editionId,
        deliveryAddressId: addressId,
        frequency: 'DAILY',
        billingCycle: 'MONTHLY',
        ...body,
      });

  // --- tests -----------------------------------------------------------------

  describe('enums stay in sync with the database', () => {
    // The domain cannot import @prisma/client (ESLint forbids it), so these could
    // silently diverge — and a status in the DB that the state machine has never heard
    // of would be un-guardable.
    it('matches Prisma exactly', () => {
      expect([...SUBSCRIPTION_STATUSES].sort()).toEqual(Object.values(PrismaStatus).sort());
      expect([...DELIVERY_FREQUENCIES].sort()).toEqual(Object.values(PrismaFrequency).sort());
      expect([...LANGUAGES].sort()).toEqual(Object.values(PrismaLanguage).sort());
      expect(['MONTHLY', 'QUARTERLY'].sort()).toEqual(Object.values(PrismaBillingCycle).sort());
    });
  });

  describe('browsing the catalogue', () => {
    it('finds an edition by pincode', async () => {
      const { token } = await customer();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/catalog/editions?pincode=${PINCODE}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const editions = response.body as { id: string; pricePerIssueRupees: string }[];
      const found = editions.find((edition) => edition.id === editionId);

      expect(found).toBeDefined();
      // Paise formatted for display, never a float.
      expect(found?.pricePerIssueRupees).toBe('4.50');
    });

    it('returns nothing for a pincode outside the delivery footprint', async () => {
      const { token } = await customer();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/catalog/editions?pincode=${OTHER_PINCODE}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const editions = response.body as { id: string }[];
      expect(editions.some((edition) => edition.id === editionId)).toBe(false);
    });

    it('hides an unavailable edition, so nobody can see what they cannot buy', async () => {
      const { token } = await customer();

      await prisma.newspaperEdition.update({
        where: { id: editionId },
        data: { isAvailable: false },
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/catalog/editions?pincode=${PINCODE}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as { id: string }[]).some((e) => e.id === editionId)).toBe(false);

      await prisma.newspaperEdition.update({
        where: { id: editionId },
        data: { isAvailable: true },
      });
    });

    it('rejects a malformed pincode', async () => {
      const { token } = await customer();

      await request(app.getHttpServer())
        .get('/api/v1/catalog/editions?pincode=abc')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('admin catalogue', () => {
    it('forbids a CUSTOMER from writing to the catalogue', async () => {
      const { token } = await customer();

      await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/publishers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Rogue Press' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/catalog/editions/${editionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pricePerIssuePaise: 1 })
        .expect(403);
    });

    it('lets OPS_STAFF manage the catalogue end to end', async () => {
      const token = await staff();

      const publisher = await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/publishers')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Admin Press ${suffix}` })
        .expect(201);

      const newspaper = await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/newspapers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          publisherId: (publisher.body as { id: string }).id,
          name: `Admin Daily ${suffix}`,
          language: 'HINDI',
        })
        .expect(201);

      const edition = await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/editions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          newspaperId: (newspaper.body as { id: string }).id,
          city: 'Delhi',
          state: 'Delhi',
          servicePincodes: ['110001'],
          pricePerIssuePaise: 600,
        })
        .expect(201);

      expect((edition.body as { pricePerIssueRupees: string }).pricePerIssueRupees).toBe('6.00');

      // Clean up the rows this test made.
      await prisma.newspaperEdition.deleteMany({
        where: { newspaperId: (newspaper.body as { id: string }).id },
      });
      await prisma.newspaper.deleteMany({ where: { id: (newspaper.body as { id: string }).id } });
      await prisma.publisher.deleteMany({ where: { id: (publisher.body as { id: string }).id } });
    });

    it('rejects a price that is not an integer number of paise', async () => {
      const token = await staff();

      // 4.5 "rupees" typed into a paise field. Accepting it would store 4 paise and
      // sell a newspaper for four hundredths of a rupee.
      await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/editions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          newspaperId,
          city: 'Nowhere',
          state: 'Karnataka',
          servicePincodes: ['560001'],
          pricePerIssuePaise: 4.5,
        })
        .expect(400);
    });

    it('refuses a second edition of the same paper in the same city', async () => {
      const token = await staff();

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/catalog/editions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          newspaperId,
          city: `Testville ${suffix}`,
          state: 'Karnataka',
          servicePincodes: ['560001'],
          pricePerIssuePaise: 500,
        })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('subscribing', () => {
    it('creates an ACTIVE subscription and copies the price', async () => {
      const { token, addressId } = await customer();

      const response = await subscribe(token, addressId).expect(201);
      const body = response.body as { status: string; pricePerIssuePaise: number };

      expect(body.status).toBe('ACTIVE');
      expect(body.pricePerIssuePaise).toBe(PRICE);
    });

    it('refuses an address outside the edition’s delivery footprint', async () => {
      const { token, addressId } = await customer(OTHER_PINCODE);

      // The worst possible failure mode is a customer who subscribes successfully, is
      // billed successfully, and receives nothing — because it looks like success to
      // everybody until they complain.
      const response = await subscribe(token, addressId).expect(400);

      expect(response.body).toMatchObject({ code: 'PINCODE_NOT_SERVICED' });
    });

    it('refuses another customer’s address', async () => {
      const alice = await customer();
      const bob = await customer();

      await subscribe(bob.token, alice.addressId).expect(404);
    });

    it('refuses a duplicate live subscription to the same edition', async () => {
      const { token, addressId } = await customer();

      await subscribe(token, addressId).expect(201);
      await subscribe(token, addressId).expect(409);
    });

    it('allows re-subscribing after cancelling', async () => {
      const { token, addressId } = await customer();

      const first = await subscribe(token, addressId).expect(201);
      const id = (first.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/v1/subscriptions/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // A cancelled subscription is terminal, but the customer is not banned from the
      // product — a fresh subscription is a NEW row, so the old one's final invoice
      // stays computable.
      await subscribe(token, addressId).expect(201);
    });

    it('refuses a backdated start date', async () => {
      const { token, addressId } = await customer();

      const response = await subscribe(token, addressId, { startDate: '2020-01-01' }).expect(422);

      expect(response.body).toMatchObject({ code: 'BACKDATED_CHANGE' });
    });

    it('refuses an unavailable edition', async () => {
      const { token, addressId } = await customer();

      await prisma.newspaperEdition.update({
        where: { id: editionId },
        data: { isAvailable: false },
      });

      const response = await subscribe(token, addressId).expect(400);
      expect(response.body).toMatchObject({ code: 'EDITION_UNAVAILABLE' });

      await prisma.newspaperEdition.update({
        where: { id: editionId },
        data: { isAvailable: true },
      });
    });

    it('does not re-price an existing subscription when the catalogue price changes', async () => {
      const { token, addressId } = await customer();
      const staffToken = await staff();

      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/catalog/editions/${editionId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ pricePerIssuePaise: 900 })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/subscriptions/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The existing subscriber keeps the price they signed up at. Otherwise a price
      // rise would silently re-bill every customer, and past invoices would stop
      // recomputing to the figures they were issued at.
      expect((after.body as { pricePerIssuePaise: number }).pricePerIssuePaise).toBe(PRICE);

      await prisma.newspaperEdition.update({
        where: { id: editionId },
        data: { pricePerIssuePaise: PRICE },
      });
    });
  });

  describe('the lifecycle state machine, over HTTP', () => {
    it('runs the happy path: pause, resume, cancel', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const act = (action: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/subscriptions/${id}/${action}`)
          .set('Authorization', `Bearer ${token}`);

      expect(((await act('pause').expect(201)).body as { status: string }).status).toBe('PAUSED');
      expect(((await act('resume').expect(201)).body as { status: string }).status).toBe('ACTIVE');
      expect(((await act('cancel').expect(201)).body as { status: string }).status).toBe(
        'CANCELLED',
      );
    });

    it('rejects an illegal transition with 409, not a silent no-op', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const act = (action: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/subscriptions/${id}/${action}`)
          .set('Authorization', `Bearer ${token}`);

      // Resuming something already running.
      const resume = await act('resume').expect(409);
      expect(resume.body).toMatchObject({ code: 'INVALID_SUBSCRIPTION_TRANSITION' });

      await act('pause').expect(201);

      // Pausing something already paused would open a second window and double-credit.
      await act('pause').expect(409);
    });

    it('makes CANCELLED terminal', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/v1/subscriptions/${id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      for (const action of ['pause', 'resume', 'cancel']) {
        await request(app.getHttpServer())
          .post(`/api/v1/subscriptions/${id}/${action}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(409);
      }

      await request(app.getHttpServer())
        .post(`/api/v1/subscriptions/${id}/change-address`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deliveryAddressId: addressId })
        .expect(409);
    });

    it('refuses to move delivery to an unserviced pincode', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const elsewhere = await request(app.getHttpServer())
        .post('/api/v1/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          line1: '12 Mount Rd',
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: OTHER_PINCODE,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/subscriptions/${id}/change-address`)
        .set('Authorization', `Bearer ${token}`)
        .send({ deliveryAddressId: (elsewhere.body as { id: string }).id })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'PINCODE_NOT_SERVICED' });
    });
  });

  describe('billing preview', () => {
    it('prorates a mid-month start and matches paise exactly', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const preview = await request(app.getHttpServer())
        .get(`/api/v1/subscriptions/${id}/charge-preview`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = preview.body as {
        billableIssues: number;
        fullPeriodIssues: number;
        amountPaise: number;
        amountRupees: string;
      };

      // The invariant, whatever today happens to be: the amount is exactly the issue
      // count times the per-issue price, with no rounding anywhere.
      expect(body.amountPaise).toBe(body.billableIssues * PRICE);
      expect(body.billableIssues).toBeLessThanOrEqual(body.fullPeriodIssues);
      expect(Number.isInteger(body.amountPaise)).toBe(true);
    });

    it('credits paused issues', async () => {
      const { token, addressId } = await customer();
      const created = await subscribe(token, addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const before = await request(app.getHttpServer())
        .get(`/api/v1/subscriptions/${id}/charge-preview`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/subscriptions/${id}/pause`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/subscriptions/${id}/charge-preview`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const paused = after.body as { billableIssues: number; pausedIssues: number };
      const active = before.body as { billableIssues: number };

      // Paused from today to the end of the period, so everything from today on is
      // credited and the bill can only go down.
      expect(paused.pausedIssues).toBeGreaterThan(0);
      expect(paused.billableIssues).toBeLessThan(active.billableIssues);
      expect(paused.billableIssues).toBeGreaterThanOrEqual(0);
    });

    it('quotes an edition the customer has not subscribed to', async () => {
      const { token } = await customer();

      const response = await request(app.getHttpServer())
        .get(
          `/api/v1/subscriptions/quote?editionId=${editionId}&frequency=SUNDAY_ONLY&billingCycle=MONTHLY`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as { billableIssues: number; amountPaise: number };

      // A month has four or five Sundays — never more.
      expect(body.billableIssues).toBeLessThanOrEqual(5);
      expect(body.amountPaise).toBe(body.billableIssues * PRICE);
    });
  });

  describe('ownership (IDOR)', () => {
    it('returns 404 — not 403 — on another customer’s subscription', async () => {
      const alice = await customer();
      const bob = await customer();

      const created = await subscribe(alice.token, alice.addressId).expect(201);
      const id = (created.body as { id: string }).id;

      const asBob = (path: string, method: 'get' | 'post' = 'get') =>
        request(app.getHttpServer())
          [method](`/api/v1/subscriptions/${id}${path}`)
          .set('Authorization', `Bearer ${bob.token}`);

      // A 403 would confirm the id is real and let an attacker enumerate ids.
      await asBob('').expect(404);
      await asBob('/charge-preview').expect(404);
      await asBob('/pause', 'post').expect(404);
      await asBob('/cancel', 'post').expect(404);

      // And Alice's subscription is untouched.
      const after = await request(app.getHttpServer())
        .get(`/api/v1/subscriptions/${id}`)
        .set('Authorization', `Bearer ${alice.token}`)
        .expect(200);

      expect((after.body as { status: string }).status).toBe('ACTIVE');
    });

    it('lists only the caller’s own subscriptions', async () => {
      const alice = await customer();
      const bob = await customer();

      await subscribe(alice.token, alice.addressId).expect(201);

      const bobsList = await request(app.getHttpServer())
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(200);

      expect(bobsList.body).toEqual([]);
    });
  });
});
