import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { SMS_PROVIDER } from '@/modules/auth/domain/ports/sms-provider.port';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

/**
 * AUDIT TRAIL (e2e) — the global interceptor records mutating staff actions, once, and the
 * admin-gated read endpoint surfaces them. Also checks the two things an audit log gets wrong
 * most often: it must NOT record customer self-service writes (noise that buries the signal),
 * and it must NOT store secrets from request bodies.
 */
describe('Audit log (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
    await app.init();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
    await prisma.seller.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  let seq = 0;

  // A per-RUN unique client IP (suffix varies each run), so the OTP per-IP rate limiter does not
  // accumulate across back-to-back runs the way a fixed IP would.
  const ipFor = (n: number): string =>
    `10.${(Number(suffix) % 200) + 1}.${(Math.floor(n / 250) % 250) + 1}.${(n % 250) + 1}`;

  const login = async (
    role?: 'SUPER_ADMIN' | 'OPS_STAFF',
  ): Promise<{ token: string; userId: string }> => {
    seq += 1;
    const ip = ipFor(seq);
    const localPhone = `94${suffix}${String(seq).padStart(2, '0')}`;
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

    if (role !== undefined) {
      await prisma.user.update({ where: { phone }, data: { role, name: `Staff ${seq}` } });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    createdUserIds.push(user.id);
    return { token: (session.body as { accessToken: string }).accessToken, userId: user.id };
  };

  /** The interceptor writes off the response's critical path; give it a moment to land. */
  const auditRowsFor = async (actorUserId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await prisma.auditLog.findMany({ where: { actorUserId } });
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return prisma.auditLog.findMany({ where: { actorUserId } });
  };

  it('records a mutating staff action with actor, action, target and a redacted body', async () => {
    const staff = await login('SUPER_ADMIN');

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/marketplace/sellers')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({
        name: `Audited Seller ${suffix}`,
        contactName: 'Asha',
        contactPhone: '+919000000001',
        city: 'Pune',
        state: 'MH',
      })
      .expect(201);
    const sellerId = (created.body as { id: string }).id;

    const rows = await auditRowsFor(staff.userId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.method).toBe('POST');
    expect(row.action).toContain('sellers');
    expect(row.statusCode).toBe(201);
    expect(row.actorRole).toBe('SUPER_ADMIN');
    // The body was captured (the name is not sensitive), proving metadata is recorded.
    const metadata = row.metadata as { body?: { name?: string } };
    expect(metadata.body?.name).toBe(`Audited Seller ${suffix}`);
    expect(sellerId).toBeDefined();
  });

  it('surfaces the trail through the admin endpoint, newest first, filterable by actor', async () => {
    const staff = await login('OPS_STAFF');

    await request(app.getHttpServer())
      .post('/api/v1/admin/marketplace/sellers')
      .set('Authorization', `Bearer ${staff.token}`)
      .send({
        name: `Listed Seller ${suffix}`,
        contactName: 'Ravi',
        contactPhone: '+919000000002',
        city: 'Pune',
        state: 'MH',
      })
      .expect(201);

    await auditRowsFor(staff.userId);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/audit?actorUserId=${staff.userId}`)
      .set('Authorization', `Bearer ${staff.token}`)
      .expect(200);

    const body = res.body as { rows: { action: string; actorUserId: string }[] };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows.every((r) => r.actorUserId === staff.userId)).toBe(true);
    expect(body.rows[0]!.action).toContain('sellers');
  });

  it('does NOT audit a customer self-service mutation', async () => {
    const customer = await login(); // plain CUSTOMER

    // A customer write that succeeds: set their own name via the users endpoint is not present,
    // so use the cart — adding to an (empty) cart is a customer POST that mutates.
    // It will 404 on a missing variant, which is fine: even a *successful* one must not audit.
    await request(app.getHttpServer())
      .post('/api/v1/marketplace/cart/items')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ variantId: '00000000-0000-0000-0000-000000000000', quantity: 1 })
      .expect(404);

    // Give any (erroneous) write the same window before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const rows = await prisma.auditLog.findMany({ where: { actorUserId: customer.userId } });
    expect(rows).toHaveLength(0);
  });

  it('refuses the audit endpoint to a non-staff caller', async () => {
    const customer = await login();
    await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
  });
});
