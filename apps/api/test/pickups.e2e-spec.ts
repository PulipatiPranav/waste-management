import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaperType as PrismaPaperType, PickupStatus as PrismaPickupStatus } from '@prisma/client';
import request from 'supertest';
import { type App } from 'supertest/types';
import { randomUUID } from 'node:crypto';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { PICKUP_STATUSES } from '@/modules/pickups/domain/pickup-state-machine';
import { PAPER_TYPES } from '@/modules/wallet/domain/money';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { RedisService } from '@/shared/infrastructure/cache/redis.service';

// 9-prefixed: structurally valid, but cannot collide with the seed catalogue's real
// Bengaluru pincodes or with a zone another suite created. See the note in delivery.e2e.
const PINCODE = '920001';

describe('Pickups, cashback & wallet (e2e)', () => {
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
      data: { name: `Pickup zone ${suffix}`, city: 'Bengaluru', pincodes: [PINCODE] },
    });
    zoneId = zone.id;

    // Retire whatever is active, and publish ours — there can be only one active card.
    await prisma.rateCard.updateMany({
      where: { isActive: true },
      data: { isActive: false, retiredAt: new Date() },
    });

    const card = await prisma.rateCard.create({
      data: {
        name: `Pickup test ${suffix}`,
        isActive: true,
        items: {
          create: [
            { paperType: 'NEWSPAPER', ratePerKgPaise: 1500 },
            { paperType: 'CARDBOARD', ratePerKgPaise: 900 },
          ],
        },
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

    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_delete"',
    );
    await prisma.walletTransaction.deleteMany({ where: { wallet: { user: users } } });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_delete"',
    );

    await prisma.pickupItem.deleteMany({ where: { pickup: { user: users } } });
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
    const phone = `+9196${suffix}${String(seq).padStart(2, '0')}`;

    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', `203.0.113.${seq}`)
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

  const partner = async () => {
    const { token, userId } = await login('DELIVERY_PARTNER');

    const row = await prisma.deliveryPartner.create({
      data: {
        userId,
        vehicleType: 'BICYCLE',
        kycStatus: 'VERIFIED',
        zones: { create: { zoneId } },
      },
    });

    return { token, userId, partnerId: row.id };
  };

  const customerWithAddress = async () => {
    const { token, userId } = await login('CUSTOMER');

    const address = await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ line1: 'Flat 1', city: 'Bengaluru', state: 'Karnataka', pincode: PINCODE })
      .expect(201);

    return { token, userId, addressId: (address.body as { id: string }).id };
  };

  const tomorrow = () => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  };

  const requestPickup = (token: string, addressId: string) =>
    request(app.getHttpServer())
      .post('/api/v1/pickups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        addressId,
        scheduledDate: tomorrow(),
        windowStartHour: 9,
        windowEndHour: 12,
      });

  /** A pickup already ASSIGNED to `partnerId`, ready to be scanned and weighed. */
  const assignedPickup = async (customerToken: string, addressId: string, partnerId: string) => {
    const created = await requestPickup(customerToken, addressId).expect(201);
    const body = created.body as { id: string; qrToken: string };

    const run = await prisma.dailyDeliveryRun.upsert({
      where: {
        runDate_partnerId_zoneId: {
          runDate: new Date(`${tomorrow()}T00:00:00Z`),
          partnerId,
          zoneId,
        },
      },
      update: {},
      create: { runDate: new Date(`${tomorrow()}T00:00:00Z`), partnerId, zoneId },
    });

    await prisma.pickupRequest.update({
      where: { id: body.id },
      data: { status: 'ASSIGNED', runId: run.id, assignedPartnerId: partnerId },
    });

    return { id: body.id, qrToken: body.qrToken };
  };

  const completeUrl = (id: string) => `/api/v1/delivery/pickups/${id}/complete`;

  // --- tests -----------------------------------------------------------------

  it('keeps the domain enums in sync with Prisma', () => {
    expect([...PICKUP_STATUSES].sort()).toEqual(Object.values(PrismaPickupStatus).sort());
    expect([...PAPER_TYPES].sort()).toEqual(Object.values(PrismaPaperType).sort());
  });

  describe('requesting a pickup', () => {
    it('returns a QR token to the OWNER', async () => {
      const customer = await customerWithAddress();

      const response = await requestPickup(customer.token, customer.addressId).expect(201);
      const body = response.body as { status: string; qrToken: string };

      expect(body.status).toBe('REQUESTED');
      // High entropy: this token authorises a partner to weigh paper against this
      // customer's wallet, so it must not be guessable.
      expect(body.qrToken.length).toBeGreaterThan(30);
    });

    it('refuses another customer’s address', async () => {
      const alice = await customerWithAddress();
      const bob = await customerWithAddress();

      await requestPickup(bob.token, alice.addressId).expect(404);
    });

    it('refuses a date in the past', async () => {
      const customer = await customerWithAddress();

      await request(app.getHttpServer())
        .post('/api/v1/pickups')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({
          addressId: customer.addressId,
          scheduledDate: '2020-01-01',
          windowStartHour: 9,
          windowEndHour: 12,
        })
        .expect(422);
    });
  });

  describe('the QR scan', () => {
    it('lets the ASSIGNED partner scan, and returns the rates', async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      const response = await request(app.getHttpServer())
        .post('/api/v1/delivery/pickups/scan')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ qrToken: pickup.qrToken })
        .expect(201);

      const body = response.body as { status: string; qrToken: string | null; rates: unknown[] };

      expect(body.status).toBe('ASSIGNED');
      expect(body.rates).toHaveLength(2);
      // The token is NOT echoed back — that would put a credential into another log and
      // another response cache for no benefit.
      expect(body.qrToken).toBeNull();
    });

    it('refuses a partner the pickup is not assigned to', async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const intruder = await partner();

      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      // Possession of the token is NOT authorisation. A partner who photographed a
      // colleague's customer's QR code must not be able to trigger a wallet credit.
      await request(app.getHttpServer())
        .post('/api/v1/delivery/pickups/scan')
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ qrToken: pickup.qrToken })
        .expect(404);
    });

    it('refuses an unknown token with the same 404 — no probing', async () => {
      const rider = await partner();

      await request(app.getHttpServer())
        .post('/api/v1/delivery/pickups/scan')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ qrToken: randomUUID() + randomUUID() })
        .expect(404);
    });
  });

  describe('completing a pickup (the money path)', () => {
    const setup = async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      return { customer, rider, pickup };
    };

    it('requires an Idempotency-Key — this endpoint moves money', async () => {
      const { rider, pickup } = await setup();

      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
        .expect(409);
    });

    it('weighs, prices and credits the wallet', async () => {
      const { customer, rider, pickup } = await setup();

      const response = await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          weights: [
            { paperType: 'NEWSPAPER', weightGrams: 5250 },
            { paperType: 'CARDBOARD', weightGrams: 3100 },
          ],
        })
        .expect(201);

      const body = response.body as {
        totalPaise: number;
        totalRupees: string;
        walletBalancePaise: string;
      };

      // 5.25 kg × ₹15 = ₹78.75; 3.1 kg × ₹9 = ₹27.90. Total ₹106.65.
      expect(body.totalPaise).toBe(10_665);
      expect(body.totalRupees).toBe('106.65');
      expect(body.walletBalancePaise).toBe('10665');

      const walletResponse = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      expect((walletResponse.body as { balanceRupees: string }).balanceRupees).toBe('106.65');
    });

    describe('idempotency', () => {
      it('replays the SAME response instead of crediting twice', async () => {
        const { customer, rider, pickup } = await setup();
        const key = randomUUID();

        const body = { weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] };

        const first = await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', key)
          .send(body)
          .expect(201);

        // The partner's phone lost signal and retried. Same key, same body.
        const replay = await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', key)
          .send(body)
          .expect(201);

        expect(replay.headers['idempotent-replay']).toBe('true');
        expect(replay.body).toEqual(first.body);

        // Paid once. 2 kg × ₹15 = ₹30.00.
        const wallet = await request(app.getHttpServer())
          .get('/api/v1/wallet')
          .set('Authorization', `Bearer ${customer.token}`)
          .expect(200);

        expect((wallet.body as { balanceRupees: string }).balanceRupees).toBe('30.00');
      });

      it('rejects the same key with a DIFFERENT body', async () => {
        const { rider, pickup } = await setup();
        const key = randomUUID();

        await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', key)
          .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
          .expect(201);

        // A client bug (or an attack). Silently returning the cached answer would be the
        // WRONG answer to this request.
        await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', key)
          .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 9000 }] })
          .expect(409);
      });

      it('still refuses a second completion under a FRESH key', async () => {
        const { customer, rider, pickup } = await setup();

        await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
          .expect(201);

        // A new key bypasses the interceptor entirely — and the state machine and the
        // ledger's unique pickupId index catch it anyway. Three independent defences,
        // because paying twice is the one failure this product cannot absorb.
        await request(app.getHttpServer())
          .post(completeUrl(pickup.id))
          .set('Authorization', `Bearer ${rider.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
          .expect(409);

        const wallet = await request(app.getHttpServer())
          .get('/api/v1/wallet')
          .set('Authorization', `Bearer ${customer.token}`)
          .expect(200);

        expect((wallet.body as { balanceRupees: string }).balanceRupees).toBe('30.00');
      });
    });

    it('refuses a partner the pickup is not assigned to', async () => {
      const { pickup } = await setup();
      const intruder = await partner();

      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${intruder.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
        .expect(404);
    });

    it('refuses a paper type the active rate card does not price', async () => {
      const { rider, pickup } = await setup();

      // Defaulting to a rate of zero would mean the customer handed over real paper and was
      // paid nothing, silently.
      const response = await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'MAGAZINE', weightGrams: 2000 }] })
        .expect(422);

      expect((response.body as { message: string }).message).toMatch(/rate card/i);
    });

    it('refuses an implausible weight — grams typed as kilograms', async () => {
      const { rider, pickup } = await setup();

      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 500_000 }] })
        .expect(400);
    });

    it('refuses a customer trying to complete their own pickup', async () => {
      const { customer, pickup } = await setup();

      // Self-service cashback would be an open cash register.
      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
        .expect(403);
    });
  });

  describe('cancelling', () => {
    it('cannot cancel a COMPLETED pickup — the cashback is already paid', async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/pickups/${pickup.id}/cancel`)
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(409);

      expect(response.body).toMatchObject({ code: 'INVALID_PICKUP_TRANSITION' });
    });
  });

  describe('the wallet and withdrawals', () => {
    const fundedCustomer = async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      // 20 kg × ₹15 = ₹300.00
      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 20_000 }] })
        .expect(201);

      return customer;
    };

    it('debits the wallet at REQUEST time, not at approval', async () => {
      const customer = await fundedCustomer();

      await request(app.getHttpServer())
        .post('/api/v1/wallet/withdrawals')
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amountPaise: 20_000,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Test User',
        })
        .expect(201);

      const wallet = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      // ₹300 - ₹200 = ₹100. If the money stayed put until ops approved, the customer could
      // request their whole balance twice.
      expect((wallet.body as { balanceRupees: string }).balanceRupees).toBe('100.00');
    });

    it('refuses a withdrawal larger than the balance', async () => {
      const customer = await fundedCustomer();

      const response = await request(app.getHttpServer())
        .post('/api/v1/wallet/withdrawals')
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amountPaise: 9_999_999,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Test User',
        })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    });

    it('cannot be marked PAID without an approval', async () => {
      const customer = await fundedCustomer();
      const staff = await login('OPS_STAFF');

      const withdrawal = await request(app.getHttpServer())
        .post('/api/v1/wallet/withdrawals')
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amountPaise: 20_000,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Test User',
        })
        .expect(201);

      const id = (withdrawal.body as { id: string }).id;

      // The manual approval step IS the control. A path around it makes the control
      // decorative — and payout automation is a compliance decision, not an engineering one.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/wallet/withdrawals/${id}/mark-paid`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ paymentRef: 'NEFT-123' })
        .expect(409);
    });

    it('approves, then marks paid — two separate human actions', async () => {
      const customer = await fundedCustomer();
      const staff = await login('OPS_STAFF');

      const withdrawal = await request(app.getHttpServer())
        .post('/api/v1/wallet/withdrawals')
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amountPaise: 20_000,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Test User',
        })
        .expect(201);

      const id = (withdrawal.body as { id: string }).id;

      const approved = await request(app.getHttpServer())
        .post(`/api/v1/admin/wallet/withdrawals/${id}/approve`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(201);

      expect((approved.body as { status: string }).status).toBe('APPROVED');

      const paid = await request(app.getHttpServer())
        .post(`/api/v1/admin/wallet/withdrawals/${id}/mark-paid`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ paymentRef: 'NEFT-2026-88213' })
        .expect(201);

      expect((paid.body as { status: string }).status).toBe('PAID');
    });

    it('rejects with a reversal credit, leaving the debit visible', async () => {
      const customer = await fundedCustomer();
      const staff = await login('OPS_STAFF');

      const withdrawal = await request(app.getHttpServer())
        .post('/api/v1/wallet/withdrawals')
        .set('Authorization', `Bearer ${customer.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          amountPaise: 20_000,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Test User',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/wallet/withdrawals/${(withdrawal.body as { id: string }).id}/reject`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ reason: 'Bank details do not match the KYC name on file.' })
        .expect(201);

      const wallet = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      // Refunded in full.
      expect((wallet.body as { balanceRupees: string }).balanceRupees).toBe('300.00');

      const statement = await request(app.getHttpServer())
        .get('/api/v1/wallet/transactions')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      const types = (statement.body as { type: string }[]).map((entry) => entry.type);

      // The debit was NOT erased. It happened, and the statement shows it happening and
      // being undone — which is what an append-only ledger means.
      expect(types).toContain('WITHDRAWAL_DEBIT');
      expect(types).toContain('WITHDRAWAL_REVERSAL');
    });

    it('lets a customer see only their own wallet', async () => {
      const alice = await fundedCustomer();
      const bob = await customerWithAddress();

      const bobsWallet = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(200);

      expect((bobsWallet.body as { balanceRupees: string }).balanceRupees).toBe('0.00');

      // And a customer cannot reach the staff lookup for someone else's wallet.
      await request(app.getHttpServer())
        .get(`/api/v1/admin/wallet/users/${alice.userId}`)
        .set('Authorization', `Bearer ${bob.token}`)
        .expect(403);
    });

    it('reconciles the cached balance against a full ledger replay', async () => {
      const customer = await fundedCustomer();
      const staff = await login('OPS_STAFF');

      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/wallet/users/${customer.userId}/reconcile`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(200);

      const body = response.body as {
        ok: boolean;
        cachedBalancePaise: string;
        ledgerBalancePaise: string;
      };

      expect(body.ok).toBe(true);
      expect(body.cachedBalancePaise).toBe(body.ledgerBalancePaise);
    });
  });

  describe('rate cards', () => {
    it('forbids a customer from publishing rates', async () => {
      const customer = await customerWithAddress();

      // The rate card decides what everyone is paid. It is not a customer-editable field.
      await request(app.getHttpServer())
        .post('/api/v1/admin/rates')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ name: 'Free money', rates: [{ paperType: 'NEWSPAPER', ratePerKgPaise: 99_999 }] })
        .expect(403);
    });

    it('keeps only one card active, and does not re-price completed pickups', async () => {
      const customer = await customerWithAddress();
      const rider = await partner();
      const staff = await login('OPS_STAFF');
      const pickup = await assignedPickup(customer.token, customer.addressId, rider.partnerId);

      await request(app.getHttpServer())
        .post(completeUrl(pickup.id))
        .set('Authorization', `Bearer ${rider.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ weights: [{ paperType: 'NEWSPAPER', weightGrams: 2000 }] })
        .expect(201);

      // Ops doubles the rate.
      const newCard = await request(app.getHttpServer())
        .post('/api/v1/admin/rates')
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          name: `Doubled ${suffix}`,
          activate: true,
          rates: [{ paperType: 'NEWSPAPER', ratePerKgPaise: 3000 }],
        })
        .expect(201);

      const active = await prisma.rateCard.findMany({ where: { isActive: true } });
      expect(active).toHaveLength(1);

      // The already-completed pickup still shows what it was actually paid. Recomputing
      // history from a mutable rate table is how a cashback ledger stops reconciling.
      const stored = await prisma.pickupItem.findFirstOrThrow({ where: { pickupId: pickup.id } });
      expect(stored.ratePerKgPaiseAtPickup).toBe(1500);
      expect(stored.amountPaise).toBe(3000);

      const wallet = await request(app.getHttpServer())
        .get('/api/v1/wallet')
        .set('Authorization', `Bearer ${customer.token}`)
        .expect(200);

      expect((wallet.body as { balanceRupees: string }).balanceRupees).toBe('30.00');

      // Put ours back so the rest of the suite is unaffected.
      await prisma.rateCard.deleteMany({ where: { id: (newCard.body as { id: string }).id } });
      await prisma.rateCard.update({ where: { id: rateCardId }, data: { isActive: true } });
    });
  });
});
