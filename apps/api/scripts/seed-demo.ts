/**
 * Fills a DEMO database with a believable slice of activity, so the hosted demo's dashboard
 * has something to show: customers with subscriptions, completed pickups that credited their
 * wallets, a batch weighed and confirmed at a mill (which is what produces impact numbers),
 * tomorrow's delivery runs, a pending withdrawal and a marketplace listing.
 *
 * It drives the REAL API in-process — the same use cases, ledger and validation a client
 * hits — rather than inserting rows, so the data obeys every invariant. Prisma is used only
 * where the e2e suite uses it too (promoting a user's role; there is no endpoint for that).
 *
 * Requires DEMO_MODE=true (every OTP is 000000). Seeds the catalogue first. Idempotent: if
 * the demo admin already exists it does nothing, so it is safe to run on every boot.
 *
 *   DEMO_MODE=true pnpm --filter @cpe/api seed:demo
 */
import 'reflect-metadata';

import { execFileSync } from 'node:child_process';

import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SECRET_HASHER, type SecretHasher } from '@/modules/auth/domain/ports/hasher.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

export const DEMO_ADMIN_EMAIL = 'demo@circularpaper.app';
export const DEMO_ADMIN_PASSWORD = 'demo-password';

const PINCODE = '560038'; // Indiranagar, Bengaluru — served by the seeded catalogue.
const DEMO_OTP = '000000';

const CUSTOMERS = [
  { phone: '+919000000101', name: 'Ananya Rao', kg: [6.2, 4.8] },
  { phone: '+919000000102', name: 'Rahul Menon', kg: [9.5] },
  { phone: '+919000000103', name: 'Priya Iyer', kg: [3.4, 5.1, 4.0] },
  { phone: '+919000000104', name: 'Karthik Reddy', kg: [12.0] },
  { phone: '+919000000105', name: 'Sneha Kulkarni', kg: [7.3, 2.9] },
  { phone: '+919000000106', name: 'Arjun Nair', kg: [5.6] },
  { phone: '+919000000107', name: 'Meera Shah', kg: [8.8, 6.1] },
  { phone: '+919000000108', name: 'Vikram Joshi', kg: [] }, // new signup, no pickups yet
];

const RIDERS = [
  { phone: '+919000000201', name: 'Suresh Kumar', vehicleType: 'BICYCLE' },
  { phone: '+919000000202', name: 'Imran Pasha', vehicleType: 'MOTORCYCLE' },
];

type Json = Record<string, unknown>;

class Client {
  constructor(private readonly base: string) {}

  async call<T = Json>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
    }
    return (text === '' ? {} : JSON.parse(text)) as T;
  }
}

function isoDate(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  if (process.env.DEMO_MODE !== 'true') {
    throw new Error('seed-demo needs DEMO_MODE=true (it signs in with the fixed demo OTP).');
  }

  // Cheap check first, so a normal boot does not pay for starting the whole app twice.
  const probe = new PrismaClient();
  const seeded = (await probe.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } })) !== null;
  await probe.$disconnect();
  if (seeded) {
    console.log('Demo data already present — skipping.');
    return;
  }

  // The catalogue (publishers, newspapers, editions) comes first: subscriptions need it.
  execFileSync(
    process.execPath,
    [require.resolve('ts-node/dist/bin'), '-r', 'tsconfig-paths/register', 'prisma/seed.ts'],
    { stdio: 'inherit' },
  );

  const app = configureApp(
    await NestFactory.create(AppModule, { logger: ['error', 'warn'], rawBody: true }),
  );
  await app.listen(0, '127.0.0.1');

  try {
    const api = new Client(await app.getUrl());
    await seed(api, app.get(PrismaService), app.get<SecretHasher>(SECRET_HASHER));
  } finally {
    await app.close();
  }
}

async function seed(api: Client, prisma: PrismaService, hasher: SecretHasher): Promise<void> {
  // --- Staff ---------------------------------------------------------------
  await prisma.user.create({
    data: {
      phone: '+919000000001',
      email: DEMO_ADMIN_EMAIL,
      name: 'Demo Admin',
      role: 'SUPER_ADMIN',
      passwordHash: await hasher.hash(DEMO_ADMIN_PASSWORD),
      phoneVerifiedAt: new Date(),
    },
  });
  const { accessToken: staff } = await api.call<{ accessToken: string }>(
    'POST',
    '/auth/staff/login',
    { body: { email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD } },
  );

  let ip = 0;
  const otpLogin = async (phone: string): Promise<string> => {
    ip += 1;
    const headers = { 'X-Forwarded-For': `198.51.100.${ip}` };
    await api.call('POST', '/auth/otp/request', { body: { phone }, headers });
    const session = await api.call<{ accessToken: string }>('POST', '/auth/otp/verify', {
      body: { phone, code: DEMO_OTP },
      headers,
    });
    return session.accessToken;
  };

  // --- Operations setup ----------------------------------------------------
  const zone = await api.call<{ id: string }>('POST', '/admin/delivery/zones', {
    token: staff,
    body: {
      name: 'Indiranagar',
      city: 'Bengaluru',
      pincodes: ['560038', '560008', '560095'],
    },
  });

  await api.call('POST', '/admin/rates', {
    token: staff,
    body: {
      name: 'Bengaluru standard rates',
      activate: true,
      rates: [
        { paperType: 'NEWSPAPER', ratePerKgPaise: 1400 },
        { paperType: 'MAGAZINE', ratePerKgPaise: 1000 },
        { paperType: 'OFFICE_PAPER', ratePerKgPaise: 1600 },
        { paperType: 'CARDBOARD', ratePerKgPaise: 800 },
        { paperType: 'OTHER', ratePerKgPaise: 400 },
      ],
    },
  });

  const riders: { token: string; partnerId: string }[] = [];
  for (const rider of RIDERS) {
    await otpLogin(rider.phone);
    const user = await prisma.user.update({
      where: { phone: rider.phone },
      data: { role: 'DELIVERY_PARTNER', name: rider.name },
    });
    const partner = await api.call<{ id: string }>('POST', '/admin/delivery/partners', {
      token: staff,
      body: { userId: user.id, vehicleType: rider.vehicleType, zoneIds: [zone.id] },
    });
    await api.call('PATCH', `/admin/delivery/partners/${partner.id}`, {
      token: staff,
      body: { kycStatus: 'VERIFIED' },
    });
    // Log in again so the token carries the new role.
    riders.push({ token: await otpLogin(rider.phone), partnerId: partner.id });
  }

  // --- Customers: address, subscription, pickups ----------------------------
  const editions = await api.call<{ id: string }[]>('GET', `/catalog/editions?pincode=${PINCODE}`, {
    token: staff,
  });
  if (editions.length === 0) {
    throw new Error(`No editions serve ${PINCODE}. Run the catalogue seed (prisma db seed) first.`);
  }

  const today = isoDate(0);
  const tomorrow = isoDate(1);
  const customers: { token: string; addressId: string; kg: number[]; name: string }[] = [];

  for (const [index, customer] of CUSTOMERS.entries()) {
    const token = await otpLogin(customer.phone);
    await prisma.user.update({ where: { phone: customer.phone }, data: { name: customer.name } });

    const created = await api.call<{ id: string }>('POST', '/addresses', {
      token,
      body: {
        line1: `${12 + index * 7}, ${index % 2 === 0 ? '100 Feet Road' : '12th Main'}`,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: PINCODE,
      },
    });

    await api.call('POST', '/subscriptions', {
      token,
      body: {
        editionId: editions[index % editions.length]!.id,
        deliveryAddressId: created.id,
        frequency: index % 3 === 2 ? 'WEEKENDS' : 'DAILY',
        billingCycle: index % 4 === 3 ? 'QUARTERLY' : 'MONTHLY',
        startDate: today,
      },
    });

    customers.push({ token, addressId: created.id, kg: customer.kg, name: customer.name });
  }

  // Each completed pickup is booked, assigned to a run, then weighed by the rider —
  // which credits the customer's wallet through the ledger.
  let pickupSeq = 0;
  for (const customer of customers) {
    for (const kg of customer.kg) {
      pickupSeq += 1;
      const rider = riders[pickupSeq % riders.length]!;
      const pickup = await api.call<{ id: string }>('POST', '/pickups', {
        token: customer.token,
        body: {
          addressId: customer.addressId,
          scheduledDate: tomorrow,
          windowStartHour: 9,
          windowEndHour: 12,
        },
      });

      const runDate = new Date(`${tomorrow}T00:00:00Z`);
      const run = await prisma.dailyDeliveryRun.upsert({
        where: {
          runDate_partnerId_zoneId: { runDate, partnerId: rider.partnerId, zoneId: zone.id },
        },
        update: {},
        create: { runDate, partnerId: rider.partnerId, zoneId: zone.id },
      });
      await prisma.pickupRequest.update({
        where: { id: pickup.id },
        data: { status: 'ASSIGNED', runId: run.id, assignedPartnerId: rider.partnerId },
      });

      const grams = Math.round(kg * 1000);
      const weights =
        pickupSeq % 3 === 0
          ? [
              { paperType: 'NEWSPAPER', weightGrams: Math.round(grams * 0.7) },
              { paperType: 'CARDBOARD', weightGrams: grams - Math.round(grams * 0.7) },
            ]
          : [{ paperType: 'NEWSPAPER', weightGrams: grams }];

      await api.call('POST', `/delivery/pickups/${pickup.id}/complete`, {
        token: rider.token,
        headers: { 'Idempotency-Key': `demo-pickup-${pickupSeq}` },
        body: { weights },
      });
    }
  }

  // Two upcoming pickups that are still waiting, so the queue is not empty.
  for (const customer of customers.slice(-2)) {
    await api.call('POST', '/pickups', {
      token: customer.token,
      body: {
        addressId: customer.addressId,
        scheduledDate: isoDate(2),
        windowStartHour: 16,
        windowEndHour: 19,
      },
    });
  }

  // --- Recycling: batch → dispatch → mill confirms ---------------------------
  const mill = await api.call<{ id: string }>('POST', '/admin/recycling/partners', {
    token: staff,
    body: {
      name: 'Deccan Paper Mills',
      acceptedPaperTypes: ['NEWSPAPER', 'MAGAZINE', 'OFFICE_PAPER', 'CARDBOARD'],
      dailyCapacityGrams: 50_000_000,
      city: 'Hosur',
      state: 'Tamil Nadu',
      pincode: '635109',
      addressLine: 'SIPCOT Industrial Area, Phase II',
      contactName: 'R. Venkatesh',
      contactPhone: '+919000000301',
    },
  });
  await api.call('PATCH', `/admin/recycling/partners/${mill.id}`, {
    token: staff,
    body: { status: 'VERIFIED' },
  });

  await api.call('POST', '/admin/recycling/batches/run', { token: staff, body: {} });
  const batches = await api.call<{ id: string }[]>('GET', '/admin/recycling/batches?status=OPEN', {
    token: staff,
  });

  for (const batch of batches) {
    await api.call('POST', `/admin/recycling/batches/${batch.id}/close`, { token: staff });
    const dispatch = await api.call<{ id: string }>(
      'POST',
      `/admin/recycling/batches/${batch.id}/dispatch`,
      {
        token: staff,
        body: {
          partnerId: mill.id,
          transporterName: 'KA Roadlines',
          transporterVehicleNo: 'KA-01-AB-1234',
          transporterContact: '+919000000302',
        },
      },
    );
    const { collectedWeightGrams: sent } = await prisma.collectionBatch.findUniqueOrThrow({
      where: { id: batch.id },
    });
    // A little moisture loss in transit, well inside the weighbridge tolerance.
    await api.call('POST', `/admin/recycling/dispatches/${dispatch.id}/confirm`, {
      token: staff,
      body: { confirmedWeightGrams: Math.round(sent * 0.98) },
    });
  }

  // --- Delivery runs: today's (mostly done) and tomorrow's (planned) ---------
  await api.call('POST', '/admin/delivery/plan', { token: staff, body: { runDate: today } });

  let stopSeq = 0;
  for (const rider of riders) {
    const runs = await api.call<{ stops: { id: string }[] }[]>(
      'GET',
      `/delivery/my-runs?date=${today}`,
      { token: rider.token },
    );
    for (const stop of runs.flatMap((run) => run.stops)) {
      stopSeq += 1;
      // Leave the last couple pending so the dashboard shows a run in progress.
      if (stopSeq > CUSTOMERS.length - 2) continue;
      const failed = stopSeq === 4;
      await api.call('POST', `/delivery/stops/${stop.id}/outcome`, {
        token: rider.token,
        body: failed
          ? { outcome: 'FAILED', reason: 'Gate locked, no answer' }
          : { outcome: 'DELIVERED' },
      });
    }
  }

  await api.call('POST', '/admin/delivery/plan', { token: staff, body: { runDate: tomorrow } });

  // --- A withdrawal waiting for finance approval ----------------------------
  await api.call('POST', '/wallet/withdrawals', {
    token: customers[3]!.token,
    headers: { 'Idempotency-Key': 'demo-withdrawal-1' },
    body: {
      amountPaise: 10_000,
      bankAccountLast4: '4821',
      bankIfsc: 'HDFC0001234',
      accountHolder: customers[3]!.name,
    },
  });

  // --- Marketplace ------------------------------------------------------------
  const seller = await api.call<{ id: string }>('POST', '/admin/marketplace/sellers', {
    token: staff,
    body: {
      name: 'Kagaz Studio',
      contactName: 'Divya Hegde',
      contactPhone: '+919000000401',
      city: 'Bengaluru',
      state: 'Karnataka',
    },
  });
  await api.call('POST', `/admin/marketplace/sellers/${seller.id}/transition`, {
    token: staff,
    body: { action: 'VERIFY' },
  });

  const products = [
    {
      name: 'Recycled paper notebook (A5)',
      slug: 'recycled-notebook-a5',
      description: '120 pages, made from collected newspaper pulp.',
      recycledContent: '100% post-consumer newspaper',
      variants: [
        { sku: 'NB-A5-RULED', name: 'Ruled', pricePaise: 14_900, stock: 80 },
        { sku: 'NB-A5-PLAIN', name: 'Plain', pricePaise: 13_900, stock: 60 },
      ],
    },
    {
      name: 'Kraft gift bags (pack of 5)',
      slug: 'kraft-gift-bags-5',
      description: 'Sturdy bags from recycled cardboard fibre.',
      recycledContent: '85% recycled cardboard',
      variants: [{ sku: 'BAG-KRAFT-5', name: 'Medium', pricePaise: 19_900, stock: 40 }],
    },
  ];

  for (const product of products) {
    const { variants, ...fields } = product;
    const created = await api.call<{ id: string }>('POST', '/admin/marketplace/products', {
      token: staff,
      body: { sellerId: seller.id, ...fields },
    });
    for (const variant of variants) {
      await api.call('POST', `/admin/marketplace/products/${created.id}/variants`, {
        token: staff,
        body: variant,
      });
    }
    await api.call('POST', `/admin/marketplace/products/${created.id}/status`, {
      token: staff,
      body: { status: 'ACTIVE' },
    });
  }

  // --- Impact ----------------------------------------------------------------
  await api.call('POST', '/admin/impact/refresh', { token: staff });

  console.log(
    `Demo data seeded: ${CUSTOMERS.length} customers, ${RIDERS.length} riders, ` +
      `${pickupSeq} completed pickups, ${batches.length} batch(es) recycled.`,
  );
  console.log(`Admin console login: ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
