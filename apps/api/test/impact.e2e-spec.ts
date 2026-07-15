import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

const PINCODE = '940001';
const KG_PER_SHORT_TON = 907.18474;
/** Locked to the published factor in sustainability-factors.ts. */
const NEWSPAPER_CO2_PER_KG = 800 / KG_PER_SHORT_TON;

describe('Sustainability impact (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  const suffix = String(Date.now()).slice(-6);
  const outbox: { to: string; body: string }[] = [];

  let zoneId: string;
  let rateCardId: string;

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

    const zone = await prisma.deliveryZone.create({
      data: { name: `Impact zone ${suffix}`, city: 'Bengaluru', pincodes: [PINCODE] },
    });
    zoneId = zone.id;

    await prisma.rateCard.updateMany({
      where: { isActive: true },
      data: { isActive: false, retiredAt: new Date() },
    });
    const card = await prisma.rateCard.create({
      data: {
        name: `Impact test ${suffix}`,
        isActive: true,
        items: { create: [{ paperType: 'NEWSPAPER', ratePerKgPaise: 1500 }] },
      },
    });
    rateCardId = card.id;
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    const users = { phone: { contains: suffix } };

    await prisma.impactMonthly.deleteMany({ where: { user: users } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_delete"',
    );
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: users } } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_delete"',
    );

    await prisma.pickupItem.deleteMany({ where: { pickup: { user: users } } });
    await prisma.batchDispatch.deleteMany({ where: { batch: { zoneId } } });
    await prisma.collectionBatch.deleteMany({ where: { zoneId } });
    await prisma.recyclingPartner.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.pickupRequest.deleteMany({ where: { user: users } });
    await prisma.wallet.deleteMany({ where: { user: users } });
    await prisma.idempotencyKey.deleteMany({ where: { user: users } });
    await prisma.dailyDeliveryRun.deleteMany({ where: { zoneId } });
    await prisma.deliveryPartnerZone.deleteMany({ where: { zoneId } });
    await prisma.deliveryPartner.deleteMany({ where: { user: users } });
    await prisma.deliveryZone.deleteMany({ where: { id: zoneId } });
    await prisma.rateCard.deleteMany({ where: { id: rateCardId } });
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
    const phone = `+9193${suffix}${String(seq).padStart(2, '0')}`;

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
   * Runs the WHOLE chain for one customer: pickup → weigh → batch → dispatch → mill confirms.
   * Returns the customer so the test can read their impact. `confirm` gates whether the mill
   * actually confirms — so a test can check that unconfirmed paper produces no impact.
   */
  const recycle = async (
    grams: number,
    staffToken: string,
    confirm: boolean,
  ): Promise<{ token: string; userId: string }> => {
    const customer = await login('CUSTOMER');
    const rider = await login('DELIVERY_PARTNER');

    const partner = await prisma.deliveryPartner.create({
      data: {
        userId: rider.userId,
        vehicleType: 'BICYCLE',
        kycStatus: 'VERIFIED',
        zones: { create: { zoneId } },
      },
    });

    const address = await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ line1: 'F1', city: 'Bengaluru', state: 'Karnataka', pincode: PINCODE })
      .expect(201);

    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    const runDate = date.toISOString().slice(0, 10);

    const pickup = await request(app.getHttpServer())
      .post('/api/v1/pickups')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        addressId: (address.body as { id: string }).id,
        scheduledDate: runDate,
        windowStartHour: 9,
        windowEndHour: 12,
      })
      .expect(201);

    const pickupId = (pickup.body as { id: string }).id;

    const run = await prisma.dailyDeliveryRun.upsert({
      where: {
        runDate_partnerId_zoneId: {
          runDate: new Date(`${runDate}T00:00:00Z`),
          partnerId: partner.id,
          zoneId,
        },
      },
      update: {},
      create: { runDate: new Date(`${runDate}T00:00:00Z`), partnerId: partner.id, zoneId },
    });

    await prisma.pickupRequest.update({
      where: { id: pickupId },
      data: { status: 'ASSIGNED', runId: run.id, assignedPartnerId: partner.id },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/delivery/pickups/${pickupId}/complete`)
      .set('Authorization', `Bearer ${rider.token}`)
      .set('Idempotency-Key', `${suffix}-${seq}-${grams}`)
      .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: grams }] })
      .expect(201);

    if (!confirm) return customer;

    // Batch → close → dispatch → mill confirms the full weight.
    const mill = await request(app.getHttpServer())
      .post('/api/v1/admin/recycling/partners')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        name: `Mill ${suffix}-${seq}`,
        acceptedPaperTypes: ['NEWSPAPER'],
        dailyCapacityGrams: 100_000_000,
        city: 'B',
        state: 'K',
        pincode: '560099',
        addressLine: 'X',
        contactName: 'S',
        contactPhone: '+919000000000',
      })
      .expect(201);
    const millId = (mill.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/recycling/partners/${millId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'VERIFIED' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/admin/recycling/batches/run')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({})
      .expect(200);

    const batches = await request(app.getHttpServer())
      .get('/api/v1/admin/recycling/batches?status=OPEN')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const batchId = (batches.body as { id: string }[])[0]!.id;

    await request(app.getHttpServer())
      .post(`/api/v1/admin/recycling/batches/${batchId}/close`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    const dispatched = await request(app.getHttpServer())
      .post(`/api/v1/admin/recycling/batches/${batchId}/dispatch`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        partnerId: millId,
        transporterName: 'KA Roadlines',
        transporterVehicleNo: 'KA-01-AB-1234',
        transporterContact: '+919000000000',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/recycling/dispatches/${(dispatched.body as { id: string }).id}/confirm`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ confirmedWeightGrams: grams })
      .expect(200);

    return customer;
  };

  const refresh = (staffToken: string) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/impact/refresh')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

  const myImpact = (token: string) =>
    request(app.getHttpServer()).get('/api/v1/impact/me').set('Authorization', `Bearer ${token}`);

  // --- tests -----------------------------------------------------------------

  it('shows zero impact for paper that has NOT reached a mill', async () => {
    const staff = await login('OPS_STAFF');
    const customer = await recycle(80_000, staff.token, /* confirm */ false);

    await refresh(staff.token);

    const response = await myImpact(customer.token).expect(200);

    // The defensible line: we only claim recycling a mill has confirmed receiving. Paper
    // collected but still in the warehouse is not recycling that has happened yet.
    expect((response.body as { lifetime: { recycledKg: number } }).lifetime.recycledKg).toBe(0);
  });

  it('computes impact for confirmed recycling, exactly against the published factor', async () => {
    const staff = await login('OPS_STAFF');
    const customer = await recycle(100_000, staff.token, /* confirm */ true);

    await refresh(staff.token);

    const response = await myImpact(customer.token).expect(200);
    const body = response.body as {
      lifetime: {
        recycledKg: number;
        landfillDivertedKg: number;
        estimatedCo2eAvoidedKg: number;
      };
      monthly: unknown[];
      disclaimer: string;
      methodology: { co2eAvoidedKg: { rigour: string; source: string } };
      computedAt: string | null;
    };

    // 100 kg recycled.
    expect(body.lifetime.recycledKg).toBe(100);
    // Landfill diversion is definitional: mass recycled == mass diverted.
    expect(body.lifetime.landfillDivertedKg).toBe(100);
    // CO2 is exactly 100 × the locked EPA WARM newspaper factor. This is the "output ==
    // constant × input" assertion the brief calls for, end to end over HTTP.
    expect(body.lifetime.estimatedCo2eAvoidedKg).toBeCloseTo(100 * NEWSPAPER_CO2_PER_KG, 2);

    // A monthly trend point exists.
    expect(body.monthly.length).toBeGreaterThanOrEqual(1);

    // Provenance and honesty travel with the numbers.
    expect(body.methodology.co2eAvoidedKg.rigour).toBe('MODELLED');
    expect(body.methodology.co2eAvoidedKg.source).toMatch(/WARM/);
    expect(body.disclaimer).toMatch(/ESTIMATED/);
    expect(body.disclaimer).toMatch(/not a certified carbon offset/i);
    expect(body.computedAt).not.toBeNull();
  });

  it('never emits an unsupported strong claim in the response', async () => {
    const staff = await login('OPS_STAFF');
    const customer = await recycle(50_000, staff.token, true);
    await refresh(staff.token);

    const response = await myImpact(customer.token).expect(200);
    const json = JSON.stringify(response.body).toLowerCase();

    // The whole payload, grepped. "carbon negative / neutral", "net zero", "certified offset"
    // must not appear as claims. (The disclaimer says "NOT a certified carbon offset", which
    // is a negation, so we check for the affirmative forms only.)
    expect(json).not.toContain('carbon negative');
    expect(json).not.toContain('carbon neutral');
    expect(json).not.toContain('net zero');
    expect(json).not.toContain('carbon-negative');
  });

  it('aggregates the whole platform, and rolls org dashboards up to zero until Phase 7', async () => {
    const staff = await login('OPS_STAFF');
    await recycle(30_000, staff.token, true);
    await recycle(20_000, staff.token, true);
    await refresh(staff.token);

    const platform = await request(app.getHttpServer())
      .get('/api/v1/admin/impact/platform')
      .set('Authorization', `Bearer ${staff.token}`)
      .expect(200);

    // The platform total includes both customers (and anything else in the DB), so it is at
    // least the 50 kg these two recycled.
    expect(
      (platform.body as { lifetime: { recycledKg: number } }).lifetime.recycledKg,
    ).toBeGreaterThanOrEqual(50);

    // Org membership does not exist until Phase 7, so an apartment correctly reports zero
    // rather than erroring.
    const apartment = await prisma.apartment.create({ data: { name: `Apt ${suffix}` } });
    const aptImpact = await request(app.getHttpServer())
      .get(`/api/v1/admin/impact/apartments/${apartment.id}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .expect(200);

    expect((aptImpact.body as { lifetime: { recycledKg: number } }).lifetime.recycledKg).toBe(0);

    await prisma.apartment.delete({ where: { id: apartment.id } });
  });

  describe('authorisation', () => {
    it('lets a customer see only their own impact', async () => {
      const alice = await recycle(40_000, (await login('OPS_STAFF')).token, true);
      const bob = await login('CUSTOMER');

      // Bob's own dashboard is his own (zero).
      const bobImpact = await myImpact(bob.token).expect(200);
      expect((bobImpact.body as { lifetime: { recycledKg: number } }).lifetime.recycledKg).toBe(0);

      // And a customer cannot reach the staff endpoint for anyone's impact.
      await request(app.getHttpServer())
        .get(`/api/v1/admin/impact/users/${alice.userId}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(403);

      await request(app.getHttpServer())
        .get('/api/v1/admin/impact/platform')
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(403);
    });
  });
});
