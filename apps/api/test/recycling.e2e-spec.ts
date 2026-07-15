import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BatchStatus as PrismaBatchStatus,
  RecyclingPartnerStatus as PrismaPartnerStatus,
} from '@prisma/client';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { BATCH_STATUSES } from '@/modules/recycling/domain/batch-state-machine';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

/** 9-prefixed: structurally valid, never collides with seed data or another suite's zone. */
const PINCODE = '930001';
const NEWSPAPER_RATE = 1500;

describe('Recycling & chain of custody (e2e)', () => {
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
      data: { name: `Recycling zone ${suffix}`, city: 'Bengaluru', pincodes: [PINCODE] },
    });
    zoneId = zone.id;

    await prisma.rateCard.updateMany({
      where: { isActive: true },
      data: { isActive: false, retiredAt: new Date() },
    });
    const card = await prisma.rateCard.create({
      data: {
        name: `Recycling test ${suffix}`,
        isActive: true,
        items: { create: [{ paperType: 'NEWSPAPER', ratePerKgPaise: NEWSPAPER_RATE }] },
      },
    });
    rateCardId = card.id;
  });

  beforeEach(async () => {
    const keys = await redis.client.keys('ratelimit:*');
    if (keys.length > 0) await redis.client.del(...keys);

    // Batching groups by (zone, paperType), so every NEWSPAPER pickup in this suite's single
    // zone lands in the SAME open batch — correct product behaviour, but it means one test's
    // items would accumulate into the next test's batch and break exact-weight assertions.
    // Wipe this suite's batches AND its completed pickup items between tests so each starts
    // from an empty warehouse. (Items are deleted, not just un-batched, so a prior test's
    // unbatched paper cannot re-join the next test's batch either.)
    const suiteUsers = { pickup: { user: { phone: { contains: suffix } } } };
    await prisma.batchDispatch.deleteMany({ where: { batch: { zoneId } } });
    await prisma.pickupItem.deleteMany({ where: suiteUsers });
    await prisma.collectionBatch.deleteMany({ where: { zoneId } });
  });

  afterAll(async () => {
    const users = { phone: { contains: suffix } };

    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_delete"',
    );
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: users } } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_delete"',
    );

    // Detach items from batches before deleting batches (onDelete: Restrict).
    await prisma.pickupItem.deleteMany({ where: { pickup: { user: users } } });
    await prisma.batchDispatch.deleteMany({ where: { batch: { zoneId } } });
    await prisma.collectionBatch.deleteMany({ where: { zoneId } });
    await prisma.recyclingPartner.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.withdrawalRequest.deleteMany({ where: { user: users } });
    await prisma.pickupRequest.deleteMany({ where: { user: users } });
    await prisma.wallet.deleteMany({ where: { user: users } });
    await prisma.idempotencyKey.deleteMany({ where: { user: users } });
    await prisma.deliveryStop.deleteMany({ where: { run: { zoneId } } });
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
    const phone = `+9194${suffix}${String(seq).padStart(2, '0')}`;

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
   * Produces a COMPLETED pickup item of `grams`, the way the real flow would — customer
   * requests, partner weighs — so the chain of custody has genuine links, not a fixture.
   */
  const completedPickup = async (grams: number, _staffToken: string): Promise<string> => {
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
      .send({ line1: 'Flat 1', city: 'Bengaluru', state: 'Karnataka', pincode: PINCODE })
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

    return customer.userId;
  };

  const verifiedMill = async (staffToken: string, capacityGrams = 5_000_000) => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/recycling/partners')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        name: `Mill ${suffix}-${(seq += 1)}`,
        acceptedPaperTypes: ['NEWSPAPER'],
        dailyCapacityGrams: capacityGrams,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560099',
        addressLine: 'Plot 14',
        gstin: '29ABCDE1234F1Z5',
        contactName: 'Suresh',
        contactPhone: '+919876543210',
      })
      .expect(201);

    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/recycling/partners/${id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'VERIFIED' })
      .expect(200);

    return id;
  };

  const runBatching = (staffToken: string) =>
    request(app.getHttpServer())
      .post('/api/v1/admin/recycling/batches/run')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});

  // --- tests -----------------------------------------------------------------

  it('keeps the domain enums in sync with Prisma', () => {
    expect([...BATCH_STATUSES].sort()).toEqual(Object.values(PrismaBatchStatus).sort());
    expect(['PENDING', 'VERIFIED', 'SUSPENDED'].sort()).toEqual(
      Object.values(PrismaPartnerStatus).sort(),
    );
  });

  describe('authorisation', () => {
    it('forbids a customer from every recycling endpoint', async () => {
      const customer = await login('CUSTOMER');

      await request(app.getHttpServer())
        .get('/api/v1/admin/recycling/partners')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);

      await request(app.getHttpServer())
        .post('/api/v1/admin/recycling/batches/run')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({})
        .expect(403);
    });
  });

  describe('partner onboarding', () => {
    it('starts a partner PENDING, never verified by default', async () => {
      const staff = await login('OPS_STAFF');

      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/recycling/partners')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          name: `Mill ${suffix}-pending`,
          acceptedPaperTypes: ['NEWSPAPER', 'CARDBOARD'],
          dailyCapacityGrams: 1_000_000,
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560099',
          addressLine: 'Plot 9',
          contactName: 'A',
          contactPhone: '+919000000000',
        })
        .expect(201);

      expect((response.body as { status: string }).status).toBe('PENDING');
    });

    it('refuses a mill that accepts no paper types', async () => {
      const staff = await login('OPS_STAFF');

      await request(app.getHttpServer())
        .post('/api/v1/admin/recycling/partners')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          name: `Mill ${suffix}-empty`,
          acceptedPaperTypes: [],
          dailyCapacityGrams: 1_000_000,
          city: 'B',
          state: 'K',
          pincode: '560099',
          addressLine: 'X',
          contactName: 'A',
          contactPhone: '+919000000000',
        })
        .expect(400);
    });
  });

  describe('batching', () => {
    it('groups completed pickups by zone and paper type, and marks big ones ready', async () => {
      const staff = await login('OPS_STAFF');
      await completedPickup(60_000, staff.token); // 60 kg > 50 kg minimum

      const response = await runBatching(staff.token).expect(200);
      const body = response.body as { itemsBatched: number; batchesReadyToDispatch: number };

      expect(body.itemsBatched).toBe(1);
      expect(body.batchesReadyToDispatch).toBe(1);
    });

    it('is idempotent: a second run batches nothing already batched', async () => {
      const staff = await login('OPS_STAFF');
      await completedPickup(60_000, staff.token);

      await runBatching(staff.token).expect(200);
      const second = await runBatching(staff.token).expect(200);

      // An item batched twice is tonnage counted twice — the fastest way to lose an audit.
      expect((second.body as { itemsBatched: number }).itemsBatched).toBe(0);
    });

    it('keeps a small batch OPEN and does not mark it ready', async () => {
      const staff = await login('OPS_STAFF');
      await completedPickup(5_000, staff.token); // well below the 50 kg minimum

      const response = await runBatching(staff.token).expect(200);

      // Not an error, and nobody is alerted — the paper keeps in the warehouse and the batch
      // keeps growing.
      expect((response.body as { batchesReadyToDispatch: number }).batchesReadyToDispatch).toBe(0);

      const batches = await request(app.getHttpServer())
        .get(`/api/v1/admin/recycling/batches?status=OPEN`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect((batches.body as unknown[]).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('the full chain of custody', () => {
    /** Batch a 60 kg pickup and return the ready OPEN batch id. */
    const readyBatch = async (
      staffToken: string,
    ): Promise<{ batchId: string; customerId: string }> => {
      const customerId = await completedPickup(60_000, staffToken);
      await runBatching(staffToken).expect(200);

      const batches = await request(app.getHttpServer())
        .get('/api/v1/admin/recycling/batches?status=OPEN')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      return { batchId: (batches.body as { id: string }[])[0]!.id, customerId };
    };

    const dispatch = (staffToken: string, batchId: string, partnerId: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/dispatch`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          partnerId,
          transporterName: 'KA Roadlines',
          transporterVehicleNo: 'KA-01-AB-1234',
          transporterContact: '+919876543210',
        });

    it('runs pickup -> batch -> dispatch -> weighbridge, and traces every link', async () => {
      const staff = await login('OPS_STAFF');
      const mill = await verifiedMill(staff.token);
      const { batchId, customerId } = await readyBatch(staff.token);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const dispatched = await dispatch(staff.token, batchId, mill).expect(200);
      const dispatchId = (dispatched.body as { id: string }).id;

      // 57 kg arrived vs 60 kg sent = exactly 5%, at tolerance, NOT flagged.
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/dispatches/${dispatchId}/confirm`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ confirmedWeightGrams: 57_000, weighbridgeSlipRef: 'WB-091' })
        .expect(200);

      const body = confirmed.body as {
        confirmedWeightGrams: number;
        discrepancyGrams: number;
        discrepancyBps: number;
        discrepancyFlagged: boolean;
      };

      expect(body.confirmedWeightGrams).toBe(57_000);
      expect(body.discrepancyGrams).toBe(-3000);
      expect(body.discrepancyBps).toBe(-500);
      expect(body.discrepancyFlagged).toBe(false);

      // The chain of custody resolves the whole path.
      const chain = await request(app.getHttpServer())
        .get(`/api/v1/admin/recycling/batches/${batchId}/chain-of-custody`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const chainBody = chain.body as {
        batch: { status: string; collectedWeightGrams: number };
        partner: { id: string } | null;
        dispatch: { confirmedWeightGrams: number } | null;
        items: { customerId: string }[];
        itemsReconcile: boolean;
      };

      expect(chainBody.batch.status).toBe('CONFIRMED');
      // We NEVER overwrote our collected weight with the mill's. Both survive.
      expect(chainBody.batch.collectedWeightGrams).toBe(60_000);
      expect(chainBody.dispatch?.confirmedWeightGrams).toBe(57_000);
      expect(chainBody.partner?.id).toBe(mill);
      expect(chainBody.items[0]?.customerId).toBe(customerId);
      // The batch weight equals the sum of its items — the chain is trustworthy.
      expect(chainBody.itemsReconcile).toBe(true);

      // And the reverse walk answers "where did MY paper go".
      const trace = await request(app.getHttpServer())
        .get(`/api/v1/admin/recycling/customers/${customerId}/trace`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect((trace.body as { partnerName: string | null }[])[0]?.partnerName).toContain('Mill');
    });

    it('FLAGS a large discrepancy and surfaces it on the incident queue', async () => {
      const staff = await login('OPS_STAFF');
      const mill = await verifiedMill(staff.token);
      const { batchId } = await readyBatch(staff.token);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const dispatched = await dispatch(staff.token, batchId, mill).expect(200);
      const dispatchId = (dispatched.body as { id: string }).id;

      // 60 kg sent, 40 kg arrived = 33% short. That is not moisture.
      const confirmed = await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/dispatches/${dispatchId}/confirm`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ confirmedWeightGrams: 40_000 })
        .expect(200);

      expect((confirmed.body as { discrepancyFlagged: boolean }).discrepancyFlagged).toBe(true);

      const flagged = await request(app.getHttpServer())
        .get('/api/v1/admin/recycling/dispatches/flagged')
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      expect((flagged.body as { id: string }[]).some((d) => d.id === dispatchId)).toBe(true);
    });

    it('refuses to dispatch to an UNVERIFIED mill', async () => {
      const staff = await login('OPS_STAFF');
      const { batchId } = await readyBatch(staff.token);

      // Onboarded but not verified.
      const pending = await request(app.getHttpServer())
        .post('/api/v1/admin/recycling/partners')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          name: `Mill ${suffix}-unverified`,
          acceptedPaperTypes: ['NEWSPAPER'],
          dailyCapacityGrams: 5_000_000,
          city: 'B',
          state: 'K',
          pincode: '560099',
          addressLine: 'X',
          contactName: 'A',
          contactPhone: '+919000000000',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      // The same KYC bar as delivery partners: an unverified mill is a stranger we would be
      // handing tonnes of a customer's property to.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/dispatch`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          partnerId: (pending.body as { id: string }).id,
          transporterName: 'KA Roadlines',
          transporterVehicleNo: 'KA-01-XY-9',
          transporterContact: '+919000000000',
        })
        .expect(409);
    });

    it('cannot dispatch a batch that has not been closed', async () => {
      const staff = await login('OPS_STAFF');
      const mill = await verifiedMill(staff.token);
      const { batchId } = await readyBatch(staff.token);

      // Still OPEN. Closing is what fixes the collected weight the weighbridge compares
      // against; dispatching an open batch would let it grow while the truck is on the road.
      await dispatch(staff.token, batchId, mill).expect(409);
    });

    it('cannot confirm the same dispatch twice', async () => {
      const staff = await login('OPS_STAFF');
      const mill = await verifiedMill(staff.token);
      const { batchId } = await readyBatch(staff.token);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const dispatched = await dispatch(staff.token, batchId, mill).expect(200);
      const dispatchId = (dispatched.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/dispatches/${dispatchId}/confirm`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ confirmedWeightGrams: 58_000 })
        .expect(200);

      // The weighbridge reading is the last word; a second would overwrite evidence.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/recycling/dispatches/${dispatchId}/confirm`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ confirmedWeightGrams: 59_000 })
        .expect(409);
    });
  });
});
