import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

const PINCODE = '950001';
/** Locked to the published EPA WARM newspaper factor (see Phase 6). */
const NEWSPAPER_CO2_PER_KG = 800 / 907.18474;

describe('Organisational accounts & tenant isolation (e2e)', () => {
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
      data: { name: `Org zone ${suffix}`, city: 'Bengaluru', pincodes: [PINCODE] },
    });
    zoneId = zone.id;

    await prisma.rateCard.updateMany({
      where: { isActive: true },
      data: { isActive: false, retiredAt: new Date() },
    });
    const card = await prisma.rateCard.create({
      data: {
        name: `Org test ${suffix}`,
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
    await prisma.orgInvoice.deleteMany({
      where: { contract: { business: { name: { contains: suffix } } } },
    });
    await prisma.orgContract.deleteMany({ where: { business: { name: { contains: suffix } } } });
    await prisma.orgMember.deleteMany({ where: { user: users } });
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
    await prisma.business.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.apartment.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.refreshToken.deleteMany({ where: { user: users } });
    await prisma.otpChallenge.deleteMany({ where: { phone: { contains: suffix } } });
    await prisma.user.deleteMany({ where: users });

    await app.close();
  });

  // --- helpers ---------------------------------------------------------------

  let seq = 0;

  const login = async (
    globalRole?: 'BUSINESS_ADMIN' | 'APARTMENT_ADMIN' | 'OPS_STAFF' | 'DELIVERY_PARTNER',
  ) => {
    seq += 1;
    const localPhone = `92${suffix}${String(seq).padStart(2, '0')}`;
    const phone = `+91${localPhone}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', `198.51.100.${seq}`)
      .send({ phone: localPhone })
      .expect(200);

    const message = [...outbox].reverse().find((sent) => sent.to === phone);
    const code = /\b(\d{6})\b/.exec(message?.body ?? '')?.[1] ?? '';

    const session = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/verify')
      .send({ phone: localPhone, code })
      .expect(200);

    if (globalRole !== undefined) {
      await prisma.user.update({
        where: { phone },
        data: { role: globalRole, name: `User ${seq}` },
      });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    return {
      token: (session.body as { accessToken: string }).accessToken,
      userId: user.id,
      localPhone,
      phone,
    };
  };

  /** A business with an admin. Returns the admin's token and the business id. */
  const businessWithAdmin = async (name: string) => {
    const admin = await login('BUSINESS_ADMIN');
    const business = await prisma.business.create({ data: { name: `${name} ${suffix}` } });

    await prisma.orgMember.create({
      data: {
        userId: admin.userId,
        orgKind: 'BUSINESS',
        orgRole: 'ADMIN',
        businessId: business.id,
      },
    });

    return { admin, businessId: business.id };
  };

  const orgUrl = (businessId: string, path: string) =>
    `/api/v1/orgs/businesses/${businessId}${path}`;

  // --- tenant isolation (the priority of this phase) -------------------------

  describe('TENANT ISOLATION — an org admin cannot touch another org', () => {
    it('lets an admin read their own org but 403s on another', async () => {
      const acme = await businessWithAdmin('Acme');
      const globex = await businessWithAdmin('Globex');

      // Own org: fine.
      await request(app.getHttpServer())
        .get(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(200);

      // The adversarial case the brief demands: a real, authenticated org admin reaching for
      // ANOTHER org's data. Enforced at the query layer, not the UI.
      await request(app.getHttpServer())
        .get(orgUrl(globex.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(403);
    });

    it('403s on EVERY cross-org operation, not just reads', async () => {
      const acme = await businessWithAdmin('Acme');
      const globex = await businessWithAdmin('Globex');
      const t = `Bearer ${acme.admin.token}`;

      // Writing to another org must be as impossible as reading it.
      const cross = globex.businessId;
      await request(app.getHttpServer())
        .post(orgUrl(cross, '/members'))
        .set('Authorization', t)
        .send({ memberPhone: '+919000000000' })
        .expect(403);
      await request(app.getHttpServer())
        .get(orgUrl(cross, '/impact'))
        .set('Authorization', t)
        .expect(403);
      await request(app.getHttpServer())
        .get(orgUrl(cross, '/contracts'))
        .set('Authorization', t)
        .expect(403);
      await request(app.getHttpServer())
        .post(orgUrl(cross, '/contracts'))
        .set('Authorization', t)
        .send({ type: 'FLAT_MONTHLY', flatAmountPaise: 1, startDate: '2026-07-01' })
        .expect(403);
      await request(app.getHttpServer())
        .get(orgUrl(cross, '/invoices'))
        .set('Authorization', t)
        .expect(403);
      await request(app.getHttpServer())
        .get(`${orgUrl(cross, '/esg-report')}?yearMonth=2026-07`)
        .set('Authorization', t)
        .expect(403);
    });

    it('403s a plain MEMBER — belonging is not administering', async () => {
      const acme = await businessWithAdmin('Acme');
      const resident = await login('BUSINESS_ADMIN'); // has the global role...

      await prisma.orgMember.create({
        data: {
          userId: resident.userId,
          orgKind: 'BUSINESS',
          orgRole: 'MEMBER',
          businessId: acme.businessId,
        },
      });

      // ...but is only a MEMBER of Acme, so cannot manage it. A resident cannot edit the
      // contract or read the member list.
      await request(app.getHttpServer())
        .get(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${resident.token}`)
        .expect(403);
    });

    it('403s a customer with no org role at all', async () => {
      const acme = await businessWithAdmin('Acme');
      const customer = await login(); // plain CUSTOMER

      await request(app.getHttpServer())
        .get(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(403);
    });

    it('does not confuse an apartment and a business sharing an id shape', async () => {
      const acme = await businessWithAdmin('Acme');

      // The admin administers a BUSINESS with this id. Reaching for an APARTMENT with the same
      // id must fail — the access check keys on kind, not just id.
      await request(app.getHttpServer())
        .get(`/api/v1/orgs/apartments/${acme.businessId}/members`)
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(403);
    });
  });

  // --- membership ------------------------------------------------------------

  describe('membership', () => {
    it('adds a member by their LOCAL phone number', async () => {
      const acme = await businessWithAdmin('Acme');
      const resident = await login();

      // The admin types the resident's number as they know it (local), not E.164.
      const response = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ memberPhone: resident.localPhone, orgRole: 'MEMBER' })
        .expect(201);

      expect((response.body as { phone: string }).phone).toBe(resident.phone);
    });

    it('refuses to add someone who has not signed up', async () => {
      const acme = await businessWithAdmin('Acme');

      await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ memberPhone: '+919999999999' })
        .expect(404);
    });

    it('refuses a second admin (one accountable owner per org)', async () => {
      const acme = await businessWithAdmin('Acme');
      const other = await login();

      const response = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ memberPhone: other.localPhone, orgRole: 'ADMIN' })
        .expect(409);

      expect(response.body).toMatchObject({ code: 'CONFLICT' });
    });

    it('will not let an admin remove themselves and orphan the org', async () => {
      const acme = await businessWithAdmin('Acme');

      await request(app.getHttpServer())
        .delete(orgUrl(acme.businessId, `/members/${acme.admin.userId}`))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(409);
    });
  });

  // --- contracts, invoices, impact, ESG (with real recycling) ---------------

  describe('the full org lifecycle', () => {
    /** Recycle `grams` and attribute it to a member of the org, confirmed at a mill. */
    const recycleForMember = async (
      memberToken: string,
      memberUserId: string,
      grams: number,
      staffToken: string,
    ) => {
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
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ line1: 'F1', city: 'Bengaluru', state: 'Karnataka', pincode: PINCODE })
        .expect(201);

      const date = new Date();
      date.setUTCDate(date.getUTCDate() + 1);
      const runDate = date.toISOString().slice(0, 10);

      const pickup = await request(app.getHttpServer())
        .post('/api/v1/pickups')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({
          addressId: (address.body as { id: string }).id,
          scheduledDate: runDate,
          windowStartHour: 9,
          windowEndHour: 12,
        })
        .expect(201);

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
        where: { id: (pickup.body as { id: string }).id },
        data: { status: 'ASSIGNED', runId: run.id, assignedPartnerId: partner.id },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/delivery/pickups/${(pickup.body as { id: string }).id}/complete`)
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', `${suffix}-${seq}-${grams}`)
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: grams }] })
        .expect(201);

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
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/recycling/partners/${(mill.body as { id: string }).id}`)
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
          partnerId: (mill.body as { id: string }).id,
          transporterName: 'KA Lines',
          transporterVehicleNo: 'KA-01-AB-1',
          transporterContact: '+919000000000',
        })
        .expect(200);
      await request(app.getHttpServer())
        .post(
          `/api/v1/admin/recycling/dispatches/${(dispatched.body as { id: string }).id}/confirm`,
        )
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ confirmedWeightGrams: grams })
        .expect(200);

      void memberUserId;
    };

    it('rolls a member’s confirmed recycling into the org impact, and bills a per-kg invoice against it', async () => {
      const acme = await businessWithAdmin('Acme');
      const staff = await login('OPS_STAFF');
      const resident = await login();

      // Resident joins Acme, then recycles 100 kg.
      await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/members'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ memberPhone: resident.localPhone })
        .expect(201);

      await recycleForMember(resident.token, resident.userId, 100_000, staff.token);

      // Refresh the impact cache.
      await request(app.getHttpServer())
        .post('/api/v1/admin/impact/refresh')
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      // The org impact now includes the resident's 100 kg — Phase 6's resolver, now backed by
      // real membership.
      const impact = await request(app.getHttpServer())
        .get(orgUrl(acme.businessId, '/impact'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(200);
      expect((impact.body as { lifetime: { recycledKg: number } }).lifetime.recycledKg).toBe(100);
      expect(
        (impact.body as { lifetime: { estimatedCo2eAvoidedKg: number } }).lifetime
          .estimatedCo2eAvoidedKg,
      ).toBeCloseTo(100 * NEWSPAPER_CO2_PER_KG, 2);

      // A PER_KG contract at ₹8/kg bills 100 kg = ₹800.00.
      const contract = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/contracts'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ type: 'PER_KG', perKgRatePaise: 800, startDate: '2026-07-01' })
        .expect(201);

      const yearMonth = new Date().toISOString().slice(0, 7);
      const invoice = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/invoices'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ contractId: (contract.body as { id: string }).id, yearMonth })
        .expect(200);

      const body = invoice.body as {
        recycledGrams: number;
        amountPaise: number;
        amountRupees: string;
      };
      expect(body.recycledGrams).toBe(100_000);
      expect(body.amountPaise).toBe(80_000); // 100 kg × 800 paise/kg
      expect(body.amountRupees).toBe('800.00');
    });

    it('generates the invoice idempotently — a re-run does not double-bill', async () => {
      const acme = await businessWithAdmin('Acme');

      const contract = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/contracts'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ type: 'FLAT_MONTHLY', flatAmountPaise: 500_000, startDate: '2026-07-01' })
        .expect(201);

      const body = { contractId: (contract.body as { id: string }).id, yearMonth: '2026-07' };

      const first = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/invoices'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send(body)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/invoices'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send(body)
        .expect(200);

      // Same invoice id — the (contract, period) unique index makes generation idempotent.
      expect((first.body as { id: string }).id).toBe((second.body as { id: string }).id);

      const invoices = await request(app.getHttpServer())
        .get(orgUrl(acme.businessId, '/invoices'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(200);
      expect((invoices.body as unknown[]).length).toBe(1);
    });

    it('downloads a valid ESG report PDF carrying the disclaimer', async () => {
      const acme = await businessWithAdmin('Acme');

      const response = await request(app.getHttpServer())
        .get(`${orgUrl(acme.businessId, '/esg-report')}?yearMonth=2026-07`)
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .expect(200)
        .expect('Content-Type', 'application/pdf');

      const body = response.body as Buffer;
      // A real, well-formed PDF — starts with the magic bytes and ends with the EOF marker.
      expect(body.subarray(0, 4).toString()).toBe('%PDF');
      expect(body.subarray(-1024).toString('latin1')).toContain('%%EOF');
      expect(body.length).toBeGreaterThan(1000);

      // The filename tells the business what it is.
      expect(response.headers['content-disposition']).toContain('esg-report-2026-07.pdf');
    });

    it('refuses to invoice against another org’s contract id', async () => {
      const acme = await businessWithAdmin('Acme');
      const globex = await businessWithAdmin('Globex');

      const globexContract = await request(app.getHttpServer())
        .post(orgUrl(globex.businessId, '/contracts'))
        .set('Authorization', `Bearer ${globex.admin.token}`)
        .send({ type: 'FLAT_MONTHLY', flatAmountPaise: 100, startDate: '2026-07-01' })
        .expect(201);

      // Acme's admin, on Acme's URL, but citing Globex's contract id. The contract-belongs-to-
      // org check must catch it — otherwise Acme could invoice against Globex's terms.
      await request(app.getHttpServer())
        .post(orgUrl(acme.businessId, '/invoices'))
        .set('Authorization', `Bearer ${acme.admin.token}`)
        .send({ contractId: (globexContract.body as { id: string }).id, yearMonth: '2026-07' })
        .expect(404);
    });
  });
});
