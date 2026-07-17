import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import {
  MARKETPLACE_REPOSITORY,
  type MarketplaceRepository,
} from '@/modules/marketplace/domain/ports/marketplace.repository';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

/**
 * MARKETPLACE E2E — the three properties the brief singles out, against real Postgres:
 * inventory races under concurrent orders, wallet+gateway split-payment atomicity, and
 * webhook idempotency. These are all properties OF the database (row locks, conditional
 * updates, unique indexes, transaction rollback); a mocked repository would pass them while
 * the real system oversold, double-charged, or double-processed.
 */
describe('Marketplace (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let repo: MarketplaceRepository;
  let webhookSecret: string;

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

    // rawBody: true so the webhook can verify the HMAC over the exact bytes — the same option
    // main.ts sets. Without it req.rawBody is undefined and every webhook 400s.
    app = configureApp(moduleRef.createNestApplication({ rawBody: true })) as INestApplication<App>;
    prisma = app.get(PrismaService);
    repo = app.get<MarketplaceRepository>(MARKETPLACE_REPOSITORY);
    webhookSecret = app.get<ConfigService>(ConfigService).get('PAYMENT_WEBHOOK_SECRET') ?? '';
    await app.init();
  });

  afterAll(async () => {
    const orderWhere = { userId: { in: createdUserIds } };
    // Ledger rows are append-only (a trigger blocks DELETE); lift it just to clean up.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_delete"',
    );
    await prisma.walletTransaction.deleteMany({
      where: { wallet: { userId: { in: createdUserIds } } },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_delete"',
    );

    await prisma.payment.deleteMany({ where: { order: orderWhere } });
    // Delete order items both by owning order AND by referenced variant — the second covers
    // any order created by a late-completing request, so the variant delete below cannot hit
    // a dangling FK.
    await prisma.orderItem.deleteMany({ where: { order: orderWhere } });
    await prisma.orderItem.deleteMany({ where: { variant: { sku: { contains: suffix } } } });
    await prisma.order.deleteMany({ where: orderWhere });
    await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
    await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.webhookEvent.deleteMany({ where: { eventId: { contains: suffix } } });
    await prisma.productVariant.deleteMany({ where: { sku: { contains: suffix } } });
    await prisma.product.deleteMany({ where: { slug: { contains: suffix } } });
    await prisma.seller.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    await app.close();
  });

  // --- helpers ---------------------------------------------------------------

  const server = () => app.getHttpServer();
  let seq = 0;

  // A distinct client IP per test user, set on EVERY request. The app runs a global 120/min
  // per-IP throttler; without this, every non-OTP call would share 127.0.0.1 and the
  // concurrent race test would trip it. Distinct IPs also model distinct real clients.
  const ipFor = (n: number): string =>
    `10.${Math.floor(n / 62500) % 250}.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`;

  const login = async (): Promise<{ token: string; userId: string; ip: string }> => {
    seq += 1;
    const ip = ipFor(seq);
    const localPhone = `93${suffix}${String(seq).padStart(2, '0')}`;
    const phone = `+91${localPhone}`;

    await request(server())
      .post('/api/v1/auth/otp/request')
      .set('X-Forwarded-For', ip)
      .send({ phone: localPhone })
      .expect(200);

    const message = [...outbox].reverse().find((sent) => sent.to === phone);
    const code = /\b(\d{6})\b/.exec(message?.body ?? '')?.[1] ?? '';

    const session = await request(server())
      .post('/api/v1/auth/otp/verify')
      .set('X-Forwarded-For', ip)
      .send({ phone: localPhone, code })
      .expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    createdUserIds.push(user.id);
    return { token: (session.body as { accessToken: string }).accessToken, userId: user.id, ip };
  };

  let productSeq = 0;

  /** A VERIFIED seller with an ACTIVE product and one variant at the given price/stock. */
  const seedProduct = async (input: {
    pricePaise: number;
    stock: number;
  }): Promise<{ variantId: string; sku: string }> => {
    productSeq += 1;
    const seller = await prisma.seller.create({
      data: {
        name: `Seller ${suffix} ${productSeq}`,
        status: 'VERIFIED',
        verifiedAt: new Date(),
        contactName: 'Test',
        contactPhone: '+919000000000',
        city: 'Pune',
        state: 'MH',
      },
    });
    const sku = `SKU-${suffix}-${productSeq}`;
    const product = await prisma.product.create({
      data: {
        sellerId: seller.id,
        name: `Notebook ${productSeq}`,
        slug: `notebook-${suffix}-${productSeq}`,
        description: 'Recycled.',
        status: 'ACTIVE',
        variants: { create: { sku, name: 'A5', pricePaise: input.pricePaise, stock: input.stock } },
      },
      include: { variants: true },
    });
    return { variantId: product.variants[0]!.id, sku };
  };

  const creditWallet = async (userId: string, paise: number): Promise<void> => {
    await prisma.wallet.upsert({
      where: { userId },
      update: { balancePaise: BigInt(paise) },
      create: { userId, balancePaise: BigInt(paise) },
    });
  };

  const walletBalance = async (userId: string): Promise<number> => {
    const row = await prisma.wallet.findUnique({ where: { userId } });
    return row === null ? 0 : Number(row.balancePaise);
  };

  const stockOf = async (variantId: string): Promise<number> => {
    const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    return row.stock;
  };

  const addToCart = (user: { token: string; ip: string }, variantId: string, quantity = 1) =>
    request(server())
      .post('/api/v1/marketplace/cart/items')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Forwarded-For', user.ip)
      .send({ variantId, quantity })
      .expect(201);

  const checkout = (user: { token: string; ip: string }, requestedWalletPaise = 0) =>
    request(server())
      .post('/api/v1/marketplace/checkout')
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Forwarded-For', user.ip)
      .set('Idempotency-Key', `co-${suffix}-${(seq += 1)}`)
      .send({ requestedWalletPaise });

  const signedWebhook = (input: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    amountPaise: number;
    eventId: string;
    eventType?: string;
    tamper?: boolean;
  }) => {
    const body = JSON.stringify({
      event: input.eventType ?? 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: input.gatewayPaymentId,
            order_id: input.gatewayOrderId,
            amount: input.amountPaise,
          },
        },
      },
    });
    const signature = createHmac('sha256', input.tamper ? 'wrong-secret' : webhookSecret)
      .update(body, 'utf8')
      .digest('hex');

    return request(server())
      .post('/api/v1/marketplace/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', input.eventId)
      .send(body);
  };

  // ===========================================================================
  // Split payment (wallet + gateway)
  // ===========================================================================

  describe('split payment: wallet + gateway, confirmed by webhook', () => {
    it('debits exactly the wallet portion, captures the gateway portion, decrements stock — atomically', async () => {
      const customer = await login();
      await creditWallet(customer.userId, 20000);
      const { variantId } = await seedProduct({ pricePaise: 50000, stock: 5 });

      await addToCart(customer, variantId);

      const res = await checkout(customer, 20000).expect(201);
      const body = res.body as {
        order: {
          id: string;
          status: string;
          walletAppliedPaise: number;
          gatewayAmountPaise: number;
        };
        gateway: { gatewayOrderId: string; amountPaise: number } | null;
      };

      expect(body.order.status).toBe('PENDING_PAYMENT');
      expect(body.order.walletAppliedPaise).toBe(20000);
      expect(body.order.gatewayAmountPaise).toBe(30000);
      expect(body.gateway).not.toBeNull();
      expect(body.gateway!.amountPaise).toBe(30000);

      // Nothing has moved yet — inventory and wallet are untouched until confirmation.
      expect(await stockOf(variantId)).toBe(5);
      expect(await walletBalance(customer.userId)).toBe(20000);

      const hook = await signedWebhook({
        gatewayOrderId: body.gateway!.gatewayOrderId,
        gatewayPaymentId: `pay_${suffix}_1`,
        amountPaise: 30000,
        eventId: `evt-${suffix}-split`,
      }).expect(200);
      expect((hook.body as { outcome: string }).outcome).toBe('confirmed');

      // All three legs moved together.
      expect(await stockOf(variantId)).toBe(4);
      expect(await walletBalance(customer.userId)).toBe(0);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.order.id },
        include: { payment: true },
      });
      expect(order.status).toBe('CONFIRMED');
      expect(order.payment?.status).toBe('CAPTURED');

      // Exactly one wallet debit for this order, tagged ORDER_PAYMENT.
      const debits = await prisma.walletTransaction.findMany({
        where: { orderId: body.order.id, type: 'ORDER_PAYMENT' },
      });
      expect(debits).toHaveLength(1);
      expect(debits[0]!.amountPaise).toBe(20000n);
    });

    it('a fully wallet-paid order confirms synchronously with no gateway leg', async () => {
      const customer = await login();
      await creditWallet(customer.userId, 50000);
      const { variantId } = await seedProduct({ pricePaise: 10000, stock: 5 });

      await addToCart(customer, variantId);
      const res = await checkout(customer, 10000).expect(201);
      const body = res.body as { order: { id: string; status: string }; gateway: unknown };

      expect(body.gateway).toBeNull();
      expect(body.order.status).toBe('CONFIRMED');
      expect(await stockOf(variantId)).toBe(4);
      expect(await walletBalance(customer.userId)).toBe(40000);
    });
  });

  // ===========================================================================
  // Split-payment ATOMICITY — rollback if the wallet leg fails post-capture
  // ===========================================================================

  describe('atomicity: if the wallet debit fails after capture, EVERYTHING rolls back and the gateway is refunded', () => {
    it('does not decrement stock, does not debit, marks the order FAILED, refunds the gateway', async () => {
      const customer = await login();
      await creditWallet(customer.userId, 20000);
      const { variantId } = await seedProduct({ pricePaise: 50000, stock: 7 });

      await addToCart(customer, variantId);
      const res = await checkout(customer, 20000).expect(201);
      const body = res.body as {
        order: { id: string };
        gateway: { gatewayOrderId: string } | null;
      };

      // The customer spends their wallet elsewhere between checkout and the webhook: the
      // planned 20000 debit can no longer be honoured.
      await creditWallet(customer.userId, 0);

      const hook = await signedWebhook({
        gatewayOrderId: body.gateway!.gatewayOrderId,
        gatewayPaymentId: `pay_${suffix}_fail`,
        amountPaise: 30000,
        eventId: `evt-${suffix}-atomic`,
      }).expect(200);
      expect((hook.body as { outcome: string }).outcome).toBe('refunded');

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: body.order.id },
        include: { payment: true },
      });
      expect(order.status).toBe('FAILED');
      // The inventory decrement rolled back WITH the failed wallet debit — the proof of atomicity.
      expect(await stockOf(variantId)).toBe(7);
      // No wallet debit landed.
      const debits = await prisma.walletTransaction.findMany({
        where: { orderId: body.order.id, type: 'ORDER_PAYMENT' },
      });
      expect(debits).toHaveLength(0);
      // The captured gateway money was returned.
      expect(order.payment?.status).toBe('REFUNDED');
      expect(order.payment?.refundId).not.toBeNull();
    });
  });

  // ===========================================================================
  // Webhook idempotency
  // ===========================================================================

  describe('webhook idempotency: the same event delivered twice', () => {
    it('confirms once; the replay is a no-op (stock, wallet, ledger untouched the second time)', async () => {
      const customer = await login();
      await creditWallet(customer.userId, 10000);
      const { variantId } = await seedProduct({ pricePaise: 40000, stock: 3 });

      await addToCart(customer, variantId);
      const res = await checkout(customer, 10000).expect(201);
      const body = res.body as {
        order: { id: string };
        gateway: { gatewayOrderId: string } | null;
      };

      const deliver = () =>
        signedWebhook({
          gatewayOrderId: body.gateway!.gatewayOrderId,
          gatewayPaymentId: `pay_${suffix}_idem`,
          amountPaise: 30000,
          eventId: `evt-${suffix}-idem`, // SAME id both times — the dedup key.
        });

      const first = await deliver().expect(200);
      const second = await deliver().expect(200);
      expect((first.body as { outcome: string }).outcome).toBe('confirmed');
      expect((second.body as { outcome: string }).outcome).toBe('already_processed');

      // Confirmed exactly once.
      expect(await stockOf(variantId)).toBe(2); // 3 - 1, not 3 - 2
      expect(await walletBalance(customer.userId)).toBe(0); // 10000 - 10000, debited once
      const debits = await prisma.walletTransaction.findMany({
        where: { orderId: body.order.id, type: 'ORDER_PAYMENT' },
      });
      expect(debits).toHaveLength(1);
      const events = await prisma.webhookEvent.findMany({
        where: { eventId: `evt-${suffix}-idem` },
      });
      expect(events).toHaveLength(1);
    });

    it('rejects a webhook whose signature does not verify (401), and does not confirm the order', async () => {
      const customer = await login();
      const { variantId } = await seedProduct({ pricePaise: 40000, stock: 2 });
      await addToCart(customer, variantId);
      const res = await checkout(customer, 0).expect(201);
      const body = res.body as {
        order: { id: string };
        gateway: { gatewayOrderId: string } | null;
      };

      await signedWebhook({
        gatewayOrderId: body.gateway!.gatewayOrderId,
        gatewayPaymentId: `pay_${suffix}_forged`,
        amountPaise: 40000,
        eventId: `evt-${suffix}-forged`,
        tamper: true, // signed with the wrong secret
      }).expect(401);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: body.order.id } });
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(await stockOf(variantId)).toBe(2);
    });
  });

  // ===========================================================================
  // Inventory race under concurrent orders
  // ===========================================================================

  describe('inventory race: more concurrent orders than stock', () => {
    it('sells exactly the available units and no more; stock never goes negative', async () => {
      const STOCK = 3;
      const BUYERS = 8;
      const { variantId } = await seedProduct({ pricePaise: 25000, stock: STOCK });

      // Build the pending orders SEQUENTIALLY — the property under test is concurrent
      // CONFIRMATION, not concurrent checkout, and firing eight keep-alive HTTP requests at an
      // in-process server at once is a supertest flake (ECONNRESET), not a system property.
      const orders: { orderId: string; gatewayOrderId: string }[] = [];
      for (let i = 0; i < BUYERS; i += 1) {
        const buyer = await login();
        await addToCart(buyer, variantId);
        const res = await checkout(buyer, 0).expect(201);
        const body = res.body as {
          order: { id: string };
          gateway: { gatewayOrderId: string } | null;
        };
        orders.push({ orderId: body.order.id, gatewayOrderId: body.gateway!.gatewayOrderId });
      }

      // Now confirm ALL of them at once — the genuine concurrent race for the last units,
      // driven through the repository so it exercises the DB row locks directly.
      const outcomes = await Promise.all(
        orders.map((order, index) =>
          repo.confirmOrderFromWebhook({
            gatewayOrderId: order.gatewayOrderId,
            gatewayPaymentId: `pay_${suffix}_race_${index}`,
            webhook: {
              provider: 'fake',
              eventId: `evt-${suffix}-race-${index}`,
              eventType: 'payment.captured',
            },
          }),
        ),
      );

      const confirmed = outcomes.filter((o) => o.status === 'CONFIRMED');
      const soldOut = outcomes.filter((o) => o.status === 'INSUFFICIENT_STOCK');

      expect(confirmed).toHaveLength(STOCK);
      expect(soldOut).toHaveLength(BUYERS - STOCK);
      // The invariant the CHECK constraint and the conditional decrement together guarantee.
      expect(await stockOf(variantId)).toBe(0);

      // Exactly STOCK orders reached CONFIRMED in the database; the losers never did.
      const confirmedInDb = await prisma.order.count({
        where: { id: { in: orders.map((o) => o.orderId) }, status: 'CONFIRMED' },
      });
      expect(confirmedInDb).toBe(STOCK);
    });
  });
});
