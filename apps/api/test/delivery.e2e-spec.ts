import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type KycStatus as PrismaKyc, StopStatus as PrismaStopStatus } from '@prisma/client';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { STOP_STATUSES } from '@/modules/delivery/domain/stop-status';
import {
  DELIVERY_EVENT_PUBLISHER,
  type StopStatusChangedEvent,
} from '@/modules/delivery/domain/ports/delivery-events.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

/** A 1x1 PNG. Small, but a genuinely valid image. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Delivery (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  const suffix = String(Date.now()).slice(-6);
  const outbox: { to: string; body: string }[] = [];

  /** The gateway is replaced by a spy: this is what proves the event actually fires. */
  const published: StopStatusChangedEvent[] = [];

  let publisherId: string;
  let newspaperId: string;

  /** Zones created by scenario(); torn down in afterAll. */
  const scenarioZoneIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue({
        send: (command: { to: string; body: string }) => {
          outbox.push(command);
          return Promise.resolve();
        },
      })
      .overrideProvider(DELIVERY_EVENT_PUBLISHER)
      .useValue({
        stopStatusChanged: (event: StopStatusChangedEvent) => published.push(event),
      })
      .compile();

    app = configureApp(moduleRef.createNestApplication()) as INestApplication<App>;
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    await app.init();

    const publisher = await prisma.publisher.create({ data: { name: `Press ${suffix}` } });
    publisherId = publisher.id;

    const newspaper = await prisma.newspaper.create({
      data: { publisherId, name: `Daily ${suffix}`, language: 'ENGLISH' },
    });
    newspaperId = newspaper.id;
  });

  beforeEach(async () => {
    published.length = 0;
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    const users = { phone: { contains: suffix } };

    const inScenarioZones = { zoneId: { in: scenarioZoneIds } };

    await prisma.deliveryStop.deleteMany({ where: { run: inScenarioZones } });
    await prisma.dailyDeliveryRun.deleteMany({ where: inScenarioZones });
    await prisma.deliveryPartnerZone.deleteMany({ where: inScenarioZones });
    await prisma.deliveryPartner.deleteMany({ where: { user: users } });
    await prisma.deliveryZone.deleteMany({ where: { id: { in: scenarioZoneIds } } });
    await prisma.subscriptionPause.deleteMany({ where: { subscription: { user: users } } });
    await prisma.subscription.deleteMany({ where: { user: users } });
    await prisma.newspaperEdition.deleteMany({ where: { newspaperId } });
    await prisma.newspaper.deleteMany({ where: { publisherId } });
    await prisma.publisher.deleteMany({ where: { id: publisherId } });
    await prisma.address.deleteMany({ where: { user: users } });
    await prisma.refreshToken.deleteMany({ where: { user: users } });
    await prisma.otpChallenge.deleteMany({ where: { phone: { contains: suffix } } });
    await prisma.user.deleteMany({ where: users });

    await app.close();
  });

  // --- helpers ---------------------------------------------------------------

  let seq = 0;

  const login = async (role: 'CUSTOMER' | 'OPS_STAFF' | 'DELIVERY_PARTNER') => {
    seq += 1;
    const phone = `+9197${suffix}${String(seq).padStart(2, '0')}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', `198.51.100.${seq}`)
      .send({ phone })
      .expect(200);

    const message = [...outbox].reverse().find((sent) => sent.to === phone);
    const code = /\b(\d{6})\b/.exec(message?.body ?? '')?.[1] ?? '';

    const session = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code })
      .expect(200);

    if (role !== 'CUSTOMER') {
      await prisma.user.update({ where: { phone }, data: { role, name: `User ${seq}` } });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });

    return { token: (session.body as { accessToken: string }).accessToken, userId: user.id };
  };

  /**
   * A private zone + pincode for ONE test.
   *
   * Every test needs its own, because the planner is global: it considers every
   * subscription and every partner in a zone. Sharing a zone means a verified partner
   * created by one test satisfies another test that is specifically asserting "nobody
   * is verified", and the failures look like product bugs rather than the test
   * pollution they are.
   */
  let zoneSeq = 0;

  const scenario = async () => {
    zoneSeq += 1;
    // A 9-prefixed pincode: structurally valid (6 digits, no leading zero) but not a real
    // Indian PIN, and not one the seed data or any other suite uses.
    //
    // The obvious `560000 + zoneSeq` walks straight into 560038 after ~38 scenarios — a
    // real Bengaluru pincode that the seed catalogue and other zones also claim. Two active
    // zones then cover it, the planner deterministically picks the other one, and this
    // suite's partner silently gets no run. The failure looks like a product bug and is
    // agonising to trace, so the fix is to make the collision impossible.
    const pincode = `9${String(10000 + zoneSeq).padStart(5, '0')}`;

    const zone = await prisma.deliveryZone.create({
      data: { name: `Zone ${suffix}-${zoneSeq}`, city: 'Bengaluru', pincodes: [pincode] },
    });

    const edition = await prisma.newspaperEdition.create({
      data: {
        newspaperId,
        city: `City ${suffix}-${zoneSeq}`,
        state: 'Karnataka',
        servicePincodes: [pincode],
        pricePerIssuePaise: 450,
      },
    });

    scenarioZoneIds.push(zone.id);

    const partner = async (overrides: { kycStatus?: PrismaKyc; isActive?: boolean } = {}) => {
      const { token, userId } = await login('DELIVERY_PARTNER');

      const row = await prisma.deliveryPartner.create({
        data: {
          userId,
          vehicleType: 'BICYCLE',
          kycStatus: overrides.kycStatus ?? 'VERIFIED',
          isActive: overrides.isActive ?? true,
          zones: { create: { zoneId: zone.id } },
        },
      });

      return { token, userId, partnerId: row.id };
    };

    const subscriber = async () => {
      const { token, userId } = await login('CUSTOMER');

      const address = await request(app.getHttpServer())
        .post('/api/v1/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send({ line1: 'Flat 1', city: 'Bengaluru', state: 'Karnataka', pincode })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          editionId: edition.id,
          deliveryAddressId: (address.body as { id: string }).id,
          frequency: 'DAILY',
          billingCycle: 'MONTHLY',
        })
        .expect(201);

      return { token, userId };
    };

    return { zoneId: zone.id, editionId: edition.id, pincode, partner, subscriber };
  };

  const today = () => new Date().toISOString().slice(0, 10);

  const planFor = (staffToken: string, date: string) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/delivery/plan')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ runDate: date });

  const myRuns = (token: string, date: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/delivery/my-runs?date=${date}`)
      .set('Authorization', `Bearer ${token}`);

  // --- tests -----------------------------------------------------------------

  it('keeps the domain enums in sync with Prisma', () => {
    expect([...STOP_STATUSES].sort()).toEqual(Object.values(PrismaStopStatus).sort());
  });

  describe('authorisation', () => {
    it('forbids a CUSTOMER from the partner and admin endpoints', async () => {
      const { token } = await login('CUSTOMER');

      await request(app.getHttpServer())
        .get('/api/v1/delivery/my-runs')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/admin/delivery/completion')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('forbids a DELIVERY_PARTNER from the admin endpoints', async () => {
      const { partner } = await scenario();
      const { token } = await partner();

      await request(app.getHttpServer())
        .post('/api/v1/admin/delivery/zones')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Rogue', city: 'X', pincodes: ['560001'] })
        .expect(403);
    });
  });

  describe('onboarding', () => {
    it('refuses to onboard a user whose role is not DELIVERY_PARTNER', async () => {
      const { zoneId } = await scenario();
      const staff = await login('OPS_STAFF');
      const customer = await login('CUSTOMER');

      // Otherwise you get a partner who cannot call a single partner endpoint — the
      // role, not the profile row, is what the guard reads.
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/delivery/partners')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ userId: customer.userId, vehicleType: 'BICYCLE', zoneIds: [zoneId] })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'CONFLICT' });
    });

    it('onboards with KYC PENDING, not verified-by-default', async () => {
      const { zoneId } = await scenario();
      const staff = await login('OPS_STAFF');
      const user = await login('DELIVERY_PARTNER');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/delivery/partners')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ userId: user.userId, vehicleType: 'SCOOTER', zoneIds: [zoneId] })
        .expect(201);

      expect(response.body).toMatchObject({ kycStatus: 'PENDING', isActive: true });
    });
  });

  describe('planning', () => {
    it('assigns a due subscription to a verified partner', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const rider = await partner();

      const response = await planFor(staff.token, today()).expect(201);
      const plan = response.body as { totalStops: number; unassigned: unknown[] };

      expect(plan.totalStops).toBeGreaterThanOrEqual(1);

      const runs = await myRuns(rider.token, today()).expect(200);
      expect((runs.body as { stops: unknown[] }[])[0]?.stops.length).toBeGreaterThanOrEqual(1);
    });

    it('reports NO_PARTNER rather than dropping a customer when nobody is verified', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      await partner({ kycStatus: 'PENDING' });

      // Silently dropping them would mean a customer billed for a paper nobody was ever
      // asked to deliver.
      const response = await planFor(staff.token, today()).expect(201);
      const plan = response.body as { unassigned: { reason: string }[] };

      expect(plan.unassigned.length).toBeGreaterThanOrEqual(1);
      expect(plan.unassigned.every((item) => item.reason === 'NO_PARTNER')).toBe(true);
    });

    it('is idempotent: re-planning does not duplicate run sheets', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const rider = await partner();

      const first = await planFor(staff.token, today()).expect(201);
      const second = await planFor(staff.token, today()).expect(201);

      expect((first.body as { created: number }).created).toBeGreaterThanOrEqual(1);
      // The second run finds everything already there. A partner halfway through their
      // round must not have a second sheet appear.
      expect((second.body as { created: number }).created).toBe(0);
      expect((second.body as { skipped: number }).skipped).toBeGreaterThanOrEqual(1);

      const runs = await myRuns(rider.token, today()).expect(200);
      expect(runs.body).toHaveLength(1);
    });
  });

  describe('recording an outcome', () => {
    const setup = async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const rider = await partner();

      await planFor(staff.token, today()).expect(201);

      const runs = await myRuns(rider.token, today()).expect(200);
      const run = (runs.body as { id: string; stops: { id: string }[] }[])[0];

      return { staff, rider, partner, runId: run?.id ?? '', stopId: run?.stops[0]?.id ?? '' };
    };

    const outcome = (token: string, stopId: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${stopId}/outcome`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('marks DELIVERED and publishes a realtime event', async () => {
      const { rider, stopId } = await setup();

      const response = await outcome(rider.token, stopId, { outcome: 'DELIVERED' }).expect(201);

      expect(response.body).toMatchObject({ status: 'DELIVERED' });
      expect((response.body as { completedAt: string }).completedAt).not.toBeNull();

      // The ops dashboard's live feed. Asserted here because a silently-dead socket is
      // invisible otherwise — the dashboard just never updates and nobody notices.
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ stopId, status: 'DELIVERED' });
    });

    it('requires a reason for FAILED', async () => {
      const { rider, stopId } = await setup();

      // "Failed" with no reason is a delivery dispute nobody can settle.
      const response = await outcome(rider.token, stopId, { outcome: 'FAILED' }).expect(422);
      expect(response.body).toMatchObject({ code: 'STOP_REASON_REQUIRED' });

      await outcome(rider.token, stopId, {
        outcome: 'FAILED',
        reason: 'Gate locked, nobody answered',
      }).expect(201);
    });

    it('forbids a reason on a successful delivery', async () => {
      const { rider, stopId } = await setup();

      const response = await outcome(rider.token, stopId, {
        outcome: 'DELIVERED',
        reason: 'why would this be here',
      }).expect(422);

      expect(response.body).toMatchObject({ code: 'STOP_REASON_NOT_ALLOWED' });
    });

    it('records once: a double submit is a 409, not an overwrite', async () => {
      const { rider, stopId } = await setup();

      await outcome(rider.token, stopId, { outcome: 'DELIVERED' }).expect(201);

      // A partner on a flaky mobile network WILL double-submit. The second must not
      // rewrite the first's reason and timestamp — by Phase 4 that record decides
      // whether the customer is billed.
      const response = await outcome(rider.token, stopId, {
        outcome: 'FAILED',
        reason: 'changed my mind',
      }).expect(409);

      expect(response.body).toMatchObject({ code: 'INVALID_STOP_TRANSITION' });

      const stop = await prisma.deliveryStop.findUniqueOrThrow({ where: { id: stopId } });
      expect(stop.status).toBe('DELIVERED');
      expect(stop.reason).toBeNull();
    });

    it('lets exactly one of two concurrent submissions win', async () => {
      const { rider, stopId } = await setup();

      const results = await Promise.allSettled([
        outcome(rider.token, stopId, { outcome: 'DELIVERED' }),
        outcome(rider.token, stopId, { outcome: 'SKIPPED', reason: 'customer away' }),
      ]);

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      // The conditional UPDATE is what makes this true; a read-then-write would let
      // both through and the last writer would silently win.
      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    });

    it('rolls the run status up from its stops', async () => {
      const { rider, runId, stopId } = await setup();

      const before = await prisma.dailyDeliveryRun.findUniqueOrThrow({ where: { id: runId } });
      expect(before.status).toBe('PENDING');

      await outcome(rider.token, stopId, { outcome: 'DELIVERED' }).expect(201);

      const after = await prisma.dailyDeliveryRun.findUniqueOrThrow({
        where: { id: runId },
        include: { stops: true },
      });

      const allDone = after.stops.every((stop) => stop.status !== 'PENDING');
      expect(after.status).toBe(allDone ? 'COMPLETED' : 'IN_PROGRESS');
    });

    it('returns 404 — not 403 — on another partner’s stop', async () => {
      const { stopId, partner } = await setup();
      const intruder = await partner();

      // A 403 would confirm the id is real, letting a partner enumerate every round
      // sheet in the city.
      await outcome(intruder.token, stopId, { outcome: 'DELIVERED' }).expect(404);

      const stop = await prisma.deliveryStop.findUniqueOrThrow({ where: { id: stopId } });
      expect(stop.status).toBe('PENDING');
    });
  });

  describe('proof photos', () => {
    const setup = async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const rider = await partner();
      await planFor(staff.token, today()).expect(201);

      const runs = await myRuns(rider.token, today()).expect(200);
      const stopId = (runs.body as { stops: { id: string }[] }[])[0]?.stops[0]?.id ?? '';

      return { rider, stopId, partner };
    };

    it('stores a photo and returns a signed URL on the stop', async () => {
      const { rider, stopId } = await setup();

      const upload = await request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${stopId}/photo`)
        .set('Authorization', `Bearer ${rider.token}`)
        .attach('photo', PNG, { filename: 'proof.png', contentType: 'image/png' })
        .expect(201);

      // The KEY is stored, not a URL: URLs expire and buckets get renamed.
      expect((upload.body as { photoKey: string }).photoKey).toContain(stopId);

      const runs = await myRuns(rider.token, today()).expect(200);
      const stop = (
        runs.body as { stops: { id: string; photoUrl: string | null }[] }[]
      )[0]?.stops.find((candidate) => candidate.id === stopId);

      // Signed and short-lived: the photo shows the inside of a customer's doorway.
      expect(stop?.photoUrl).toContain('signature=');
      expect(stop?.photoUrl).toContain('expires=');
    });

    it('rejects a non-image upload', async () => {
      const { rider, stopId } = await setup();

      await request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${stopId}/photo`)
        .set('Authorization', `Bearer ${rider.token}`)
        .attach('photo', Buffer.from('#!/bin/sh\nrm -rf /'), {
          filename: 'evil.sh',
          contentType: 'application/x-sh',
        })
        .expect(400);
    });

    it('refuses to attach a photo to another partner’s stop', async () => {
      const { stopId, partner } = await setup();
      const intruder = await partner();

      await request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${stopId}/photo`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .attach('photo', PNG, { filename: 'proof.png', contentType: 'image/png' })
        .expect(404);
    });
  });

  describe('admin operations', () => {
    it('reports completion rates, with null (not 0%) for an empty run', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const rider = await partner();
      await planFor(staff.token, today()).expect(201);

      const runs = await myRuns(rider.token, today()).expect(200);
      const stopId = (runs.body as { stops: { id: string }[] }[])[0]?.stops[0]?.id ?? '';

      await request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${stopId}/outcome`)
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ outcome: 'DELIVERED' })
        .expect(201);

      const stats = await request(app.getHttpServer())
        .get(`/api/v1/admin/delivery/completion?date=${today()}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const mine = (stats.body as { partnerId: string; delivered: number; total: number }[]).find(
        (stat) => stat.partnerId === rider.partnerId,
      );

      expect(mine?.delivered).toBe(1);
      expect(mine?.total).toBeGreaterThanOrEqual(1);
    });

    it('reassigns an untouched run', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const first = await partner();

      await planFor(staff.token, today()).expect(201);

      // The SECOND partner is created only AFTER planning, on purpose. With two eligible
      // partners in the zone the planner tie-breaks on partner uuid, so the single stop
      // would land on either of them at random — and this test would pass or fail on a coin
      // flip. Planning against exactly one partner makes the assignment deterministic.
      const second = await partner();

      const runs = await myRuns(first.token, today()).expect(200);
      const runId = (runs.body as { id: string }[])[0]?.id ?? '';

      await request(app.getHttpServer())
        .post(`/api/v1/admin/delivery/runs/${runId}/reassign`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ toPartnerId: second.partnerId })
        .expect(201);

      // It left the first partner's sheet and appeared on the second's.
      expect((await myRuns(first.token, today()).expect(200)).body).toHaveLength(0);
      expect((await myRuns(second.token, today()).expect(200)).body).toHaveLength(1);
    });

    it('refuses to reassign a run that has already been started', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const first = await partner();

      await planFor(staff.token, today()).expect(201);

      // Second partner created after planning — see the note above.
      const second = await partner();

      const runs = await myRuns(first.token, today()).expect(200);
      const run = (runs.body as { id: string; stops: { id: string }[] }[])[0];

      await request(app.getHttpServer())
        .post(`/api/v1/delivery/stops/${run?.stops[0]?.id}/outcome`)
        .set('Authorization', `Bearer ${first.token}`)
        .send({ outcome: 'DELIVERED' })
        .expect(201);

      // Moving a half-done run would attribute the first partner's completed deliveries
      // to the second — and in Phase 4 those records decide who gets billed.
      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/delivery/runs/${run?.id}/reassign`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ toPartnerId: second.partnerId })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses to reassign to an unverified partner', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      await subscriber();
      const first = await partner();

      await planFor(staff.token, today()).expect(201);

      // Unverified, so the planner would never have picked them anyway — but created after
      // planning regardless, to keep the assignment deterministic.
      const unverified = await partner({ kycStatus: 'PENDING' });

      const runs = await myRuns(first.token, today()).expect(200);
      const runId = (runs.body as { id: string }[])[0]?.id ?? '';

      // Reassignment must not be a back door around the KYC gate the planner enforces.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/delivery/runs/${runId}/reassign`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ toPartnerId: unverified.partnerId })
        .expect(409);
    });

    it('stops assigning work to an offboarded partner', async () => {
      const { partner, subscriber } = await scenario();
      const staff = await login('OPS_STAFF');
      const rider = await partner();

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/delivery/partners/${rider.partnerId}`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ isActive: false })
        .expect(200);

      await subscriber();

      const response = await planFor(staff.token, today()).expect(201);
      const plan = response.body as { unassigned: { reason: string }[] };

      expect(plan.unassigned.some((item) => item.reason === 'NO_PARTNER')).toBe(true);
    });
  });
});
