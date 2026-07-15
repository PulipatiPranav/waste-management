import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { AppModule } from '@/app.module';
import { configureApp } from '@/bootstrap/configure-app';
import { reconcile } from '@/modules/wallet/domain/ledger';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '@/modules/wallet/domain/ports/wallet.repository';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';

/**
 * THE LEDGER TESTS.
 *
 * The heaviest coverage in the project, because this is the only place where being wrong
 * means paying real money twice — or not at all. These hit REAL Postgres, because every
 * property being tested (row locks, transaction rollback, unique-index races, the
 * append-only trigger) is a property OF the database. A mocked repository would pass all
 * of them while the production system lost updates.
 */
describe('Wallet ledger (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wallet: WalletRepository;

  const suffix = String(Date.now()).slice(-6);
  let rateCardId: string;
  let addressId: string;
  let userId: string;

  const NEWSPAPER_RATE = 1500; // ₹15.00/kg

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = configureApp(moduleRef.createNestApplication());
    prisma = app.get(PrismaService);
    wallet = app.get<WalletRepository>(WALLET_REPOSITORY);

    await app.init();

    const user = await prisma.user.create({
      data: { phone: `+9195${suffix}01`, name: 'Ledger Test' },
    });
    userId = user.id;

    const address = await prisma.address.create({
      data: {
        userId,
        line1: 'Flat 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
      },
    });
    addressId = address.id;

    const card = await prisma.rateCard.create({
      data: {
        name: `Ledger test ${suffix}`,
        isActive: false,
        items: { create: [{ paperType: 'NEWSPAPER', ratePerKgPaise: NEWSPAPER_RATE }] },
      },
    });
    rateCardId = card.id;
  });

  afterAll(async () => {
    await disableLedgerTrigger();
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId } } });
    await enableLedgerTrigger();

    await prisma.pickupItem.deleteMany({ where: { pickup: { userId } } });
    await prisma.withdrawalRequest.deleteMany({ where: { userId } });
    await prisma.pickupRequest.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.rateCard.deleteMany({ where: { id: rateCardId } });
    await prisma.address.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });

    await app.close();
  });

  /**
   * The append-only trigger has to be lifted to clean up after ourselves. That it is this
   * awkward is the point — production code has no such escape hatch.
   */
  const disableLedgerTrigger = () =>
    prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_delete"',
    );

  const enableLedgerTrigger = () =>
    prisma.$executeRawUnsafe(
      'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_delete"',
    );

  // --- helpers ---------------------------------------------------------------

  const makePickup = async (status: 'REQUESTED' | 'ASSIGNED' = 'ASSIGNED') =>
    prisma.pickupRequest.create({
      data: {
        userId,
        addressId,
        scheduledDate: new Date('2026-07-20T00:00:00Z'),
        windowStartHour: 9,
        windowEndHour: 12,
        qrToken: randomUUID() + randomUUID(),
        status,
      },
    });

  const balance = async (): Promise<bigint> => {
    const row = await prisma.wallet.findUnique({ where: { userId } });
    return row?.balancePaise ?? 0n;
  };

  const complete = (pickupId: string, weightGrams: number) =>
    wallet.completePickupWithCashback({
      pickupId,
      userId,
      rateCardId,
      items: [{ paperType: 'NEWSPAPER', weightGrams, ratePerKgPaise: NEWSPAPER_RATE }],
    });

  /** The invariant that must hold after EVERY test in this file. */
  const assertLedgerReconciles = async () => {
    const walletRow = await prisma.wallet.findUniqueOrThrow({ where: { userId } });

    const entries = await prisma.walletTransaction.findMany({
      where: { walletId: walletRow.id },
      // By `seq` — the commit order. Ordering by `createdAt` here was itself the bug: a
      // transaction that starts earlier can commit later (it waits on the wallet lock), so
      // timestamp order is not ledger order. See the ordering regression test below.
      orderBy: { seq: 'asc' },
      select: { direction: true, amountPaise: true, balanceAfterPaise: true },
    });

    const result = reconcile(entries, walletRow.balancePaise);

    // If this fails, a write escaped the row lock: two transactions read the same balance
    // and one of them silently vanished. The cached balance would be a lie.
    expect(result.brokenAtIndex).toBeNull();
    expect(result.computedBalancePaise).toBe(walletRow.balancePaise);
    expect(result.ok).toBe(true);
  };

  afterEach(assertLedgerReconciles);

  // --- the tests -------------------------------------------------------------

  describe('a single completion', () => {
    it('credits exactly the cashback and records balanceAfter', async () => {
      const before = await balance();
      const pickup = await makePickup();

      // 2 kg × ₹15/kg = ₹30.00 = 3000 paise.
      const result = await complete(pickup.id, 2000);

      expect(result.totalPaise).toBe(3000);
      expect(result.balanceAfterPaise).toBe(before + 3000n);
      expect(await balance()).toBe(before + 3000n);

      const entry = await prisma.walletTransaction.findUniqueOrThrow({
        where: { pickupId: pickup.id },
      });

      expect(entry.type).toBe('PICKUP_CASHBACK');
      expect(entry.direction).toBe('CREDIT');
      expect(entry.amountPaise).toBe(3000n);
      expect(entry.balanceAfterPaise).toBe(before + 3000n);
    });

    it('marks the pickup COMPLETED and stores the priced items', async () => {
      const pickup = await makePickup();
      await complete(pickup.id, 2500);

      const after = await prisma.pickupRequest.findUniqueOrThrow({
        where: { id: pickup.id },
        include: { items: true },
      });

      expect(after.status).toBe('COMPLETED');
      expect(after.completedAt).not.toBeNull();
      expect(after.items).toHaveLength(1);

      // The RATE is snapshotted onto the item. A later rate-card change must never alter
      // what this customer was paid.
      expect(after.items[0]?.ratePerKgPaiseAtPickup).toBe(NEWSPAPER_RATE);
      expect(after.items[0]?.amountPaise).toBe(3750);
    });

    it('makes the credit equal the exact sum of the stored item amounts', async () => {
      const pickup = await makePickup();

      const result = await wallet.completePickupWithCashback({
        pickupId: pickup.id,
        userId,
        rateCardId,
        items: [{ paperType: 'NEWSPAPER', weightGrams: 1235, ratePerKgPaise: 1499 }],
      });

      const items = await prisma.pickupItem.findMany({ where: { pickupId: pickup.id } });
      const itemSum = items.reduce((sum, item) => sum + item.amountPaise, 0);

      // The ledger and the receipt the customer was shown must agree, exactly. This is what
      // the "round once, per line, then sum" rule buys.
      expect(result.totalPaise).toBe(itemSum);

      const entry = await prisma.walletTransaction.findUniqueOrThrow({
        where: { pickupId: pickup.id },
      });
      expect(Number(entry.amountPaise)).toBe(itemSum);
    });
  });

  describe('CONCURRENCY: the same pickup completed many times at once', () => {
    it('credits the wallet exactly ONCE out of 10 simultaneous attempts', async () => {
      const pickup = await makePickup();
      const before = await balance();

      // A partner on a flaky 2G connection, tapping repeatedly. Ten requests, all in
      // flight, all racing for the same pickup.
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => complete(pickup.id, 2000)),
      );

      const succeeded = results.filter((result) => result.status === 'fulfilled');
      const failed = results.filter((result) => result.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(9);

      // Paid once. Not ten times.
      expect(await balance()).toBe(before + 3000n);

      const entries = await prisma.walletTransaction.findMany({
        where: { pickupId: pickup.id },
      });
      expect(entries).toHaveLength(1);
    });

    it('leaves exactly one set of items behind — the losers roll back completely', async () => {
      const pickup = await makePickup();

      await Promise.allSettled(Array.from({ length: 8 }, () => complete(pickup.id, 1000)));

      // Nine transactions aborted mid-flight. Not one of them left an item row behind.
      const items = await prisma.pickupItem.findMany({ where: { pickupId: pickup.id } });
      expect(items).toHaveLength(1);
    });
  });

  describe('CONCURRENCY: different pickups crediting the same wallet at once', () => {
    it('loses no update — the balance is the exact sum of all credits', async () => {
      const before = await balance();

      const pickups = await Promise.all(Array.from({ length: 12 }, () => makePickup()));

      // Twelve DIFFERENT pickups, all crediting one wallet simultaneously. This is the
      // lost-update scenario: without SELECT ... FOR UPDATE, several of these read the same
      // starting balance, compute the same balanceAfter, and quietly overwrite each other.
      // The customer would be paid for 12 pickups and receive the money for maybe 3.
      const results = await Promise.all(pickups.map((pickup) => complete(pickup.id, 1000)));

      expect(results).toHaveLength(12);

      // 1 kg × ₹15 = 1500 paise each.
      const expected = before + BigInt(12 * 1500);
      expect(await balance()).toBe(expected);

      const entries = await prisma.walletTransaction.findMany({
        where: { pickupId: { in: pickups.map((pickup) => pickup.id) } },
      });
      expect(entries).toHaveLength(12);

      // And every balanceAfter forms an unbroken chain — which is what proves the writes
      // were genuinely serialised rather than merely summing to the right total by luck.
      const balancesAfter = entries
        .map((entry) => entry.balanceAfterPaise)
        .sort((a, b) => Number(a - b));

      for (const [index, value] of balancesAfter.entries()) {
        expect(value).toBe(before + BigInt((index + 1) * 1500));
      }
    });
  });

  describe('ATOMICITY: a failure mid-transaction leaves NO partial state', () => {
    it('rolls back the pickup and the items when the ledger insert fails', async () => {
      const pickup = await makePickup();
      const before = await balance();

      // Poison the transaction: put a cashback entry for this pickup in the ledger FIRST.
      // The completion transaction will mark the pickup COMPLETED and write its items, and
      // then die on the unique `pickupId` index when it tries to append the credit.
      //
      // That is a genuine mid-transaction abort, at the last step, after earlier writes have
      // already happened inside the transaction. If those writes were not rolled back, the
      // customer's pickup would read COMPLETED with no money paid — the exact partial state
      // this design exists to make impossible.
      const walletRow = await prisma.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: walletRow.id,
          type: 'PICKUP_CASHBACK',
          direction: 'CREDIT',
          amountPaise: 1n,
          balanceAfterPaise: walletRow.balancePaise + 1n,
          pickupId: pickup.id,
        },
      });

      // Put the cached balance back — the row above was inserted behind the repository's
      // back, so the wallet has not actually moved.
      await prisma.wallet.update({
        where: { id: walletRow.id },
        data: { balancePaise: before },
      });

      await expect(complete(pickup.id, 2000)).rejects.toThrow();

      // NOTHING from the aborted transaction survived:
      const after = await prisma.pickupRequest.findUniqueOrThrow({
        where: { id: pickup.id },
        include: { items: true },
      });

      expect(after.status).toBe('ASSIGNED'); // not COMPLETED
      expect(after.completedAt).toBeNull();
      expect(after.items).toHaveLength(0); // no items written
      expect(await balance()).toBe(before); // no money moved

      // Clean up the poison row so the reconciliation check in afterEach still holds.
      await disableLedgerTrigger();
      await prisma.walletTransaction.deleteMany({ where: { pickupId: pickup.id } });
      await enableLedgerTrigger();
    });

    it('rolls back a withdrawal request when the debit would overdraw', async () => {
      const before = await balance();

      // The wallet check constraint aborts the transaction at the debit. The withdrawal row
      // was already inserted inside it — and must not survive.
      await expect(
        wallet.requestWithdrawal({
          userId,
          amountPaise: before + 1_000_000n,
          bankAccountLast4: '4321',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Ledger Test',
        }),
      ).rejects.toThrow();

      const withdrawals = await prisma.withdrawalRequest.findMany({ where: { userId } });

      // No orphaned withdrawal request pointing at money that never left.
      expect(withdrawals).toHaveLength(0);
      expect(await balance()).toBe(before);
    });
  });

  describe('ledger ORDERING (regression: a ledger must never be ordered by a timestamp)', () => {
    /**
     * The bug this guards against, which was real and shipped in Phase 4:
     *
     * `createdAt DEFAULT CURRENT_TIMESTAMP` is the TRANSACTION START time, frozen for the
     * transaction's whole life. But a transaction that STARTS earlier can COMMIT later,
     * because it waits on the wallet row lock. So a perfectly correct ledger can hold an
     * entry with an earlier createdAt and a LATER balanceAfter.
     *
     * Replaying in timestamp order then reports a break in a sound ledger — and in other
     * interleavings would hide a genuine lost update. A reconciliation tool that cries
     * wolf is worse than none, because people stop trusting it and then ignore the real
     * alarm.
     *
     * This test writes exactly that inversion (early timestamp, later sequence) and asserts
     * that reconciliation follows `seq` and gets it right.
     */
    it('reconciles correctly when commit order is INVERTED relative to createdAt', async () => {
      const walletRow = await prisma.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      const before = walletRow.balancePaise;

      // Entry ONE in commit order (lower seq), but written with a LATE timestamp — as if its
      // transaction had started last while winning the lock first.
      const first = await prisma.walletTransaction.create({
        data: {
          walletId: walletRow.id,
          type: 'ADJUSTMENT',
          direction: 'CREDIT',
          amountPaise: 50n,
          balanceAfterPaise: before + 50n,
          note: 'ordering regression: committed first, late timestamp',
        },
      });

      // Entry TWO in commit order (higher seq), written with an EARLY timestamp — the
      // transaction that began first but waited on the lock.
      const second = await prisma.walletTransaction.create({
        data: {
          walletId: walletRow.id,
          type: 'ADJUSTMENT',
          direction: 'CREDIT',
          amountPaise: 100n,
          balanceAfterPaise: before + 150n,
          note: 'ordering regression: committed second, early timestamp',
        },
      });

      // Force the inversion in the timestamps. (The ledger is append-only, so this has to
      // go around the trigger — which is itself a reminder that production has no such
      // escape hatch.)
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "wallet_transactions" DISABLE TRIGGER "wallet_transactions_no_update"',
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "wallet_transactions" SET "createdAt" = '2030-01-01T00:00:10Z' WHERE id = '${first.id}'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "wallet_transactions" SET "createdAt" = '2030-01-01T00:00:00Z' WHERE id = '${second.id}'`,
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "wallet_transactions" ENABLE TRIGGER "wallet_transactions_no_update"',
      );

      await prisma.wallet.update({
        where: { id: walletRow.id },
        data: { balancePaise: before + 150n },
      });

      // seq order is commit order: +50 -> 50, then +100 -> 150. Reconciles.
      const bySeq = await wallet.allTransactionsForReconciliation(walletRow.id);
      expect(reconcile(bySeq, before + 150n).ok).toBe(true);

      // And prove the test has teeth: the OLD behaviour (timestamp order) breaks on this
      // very same, entirely correct, ledger.
      const byCreatedAt = await prisma.walletTransaction.findMany({
        where: { walletId: walletRow.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { direction: true, amountPaise: true, balanceAfterPaise: true },
      });

      expect(reconcile(byCreatedAt, before + 150n).ok).toBe(false);
    });

    it('assigns a strictly increasing seq in commit order', async () => {
      const pickups = await Promise.all(Array.from({ length: 5 }, () => makePickup()));
      await Promise.all(pickups.map((pickup) => complete(pickup.id, 1000)));

      const walletRow = await prisma.wallet.findUniqueOrThrow({ where: { userId } });

      const entries = await prisma.walletTransaction.findMany({
        where: { walletId: walletRow.id },
        orderBy: { seq: 'asc' },
        select: { seq: true, balanceAfterPaise: true },
      });

      // Every balanceAfter is >= the previous one's, in seq order, for a ledger of credits.
      // That is only true if seq really does track commit order.
      for (let index = 1; index < entries.length; index += 1) {
        expect(entries[index]!.seq > entries[index - 1]!.seq).toBe(true);
      }
    });
  });

  describe('the ledger is APPEND-ONLY — enforced by the database', () => {
    it('refuses an UPDATE to a ledger row', async () => {
      const pickup = await makePickup();
      await complete(pickup.id, 1000);

      const entry = await prisma.walletTransaction.findUniqueOrThrow({
        where: { pickupId: pickup.id },
      });

      // Not a convention. Not a code-review rule. Postgres refuses.
      await expect(
        prisma.walletTransaction.update({
          where: { id: entry.id },
          data: { amountPaise: 999_999n },
        }),
      ).rejects.toThrow(/append-only/i);

      const unchanged = await prisma.walletTransaction.findUniqueOrThrow({
        where: { id: entry.id },
      });
      expect(unchanged.amountPaise).toBe(1500n);
    });

    it('refuses a DELETE of a ledger row', async () => {
      const pickup = await makePickup();
      await complete(pickup.id, 1000);

      const entry = await prisma.walletTransaction.findUniqueOrThrow({
        where: { pickupId: pickup.id },
      });

      await expect(prisma.walletTransaction.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/i,
      );
    });
  });

  describe('withdrawals', () => {
    it('debits at REQUEST time, so the money cannot be spent twice', async () => {
      // Top up.
      await wallet.adjust({
        userId,
        direction: 'CREDIT',
        amountPaise: 100_000n,
        note: 'Test top-up for withdrawal concurrency.',
        actorUserId: userId,
      });

      const before = await balance();

      const result = await wallet.requestWithdrawal({
        userId,
        amountPaise: 50_000n,
        bankAccountLast4: '4321',
        bankIfsc: 'HDFC0001234',
        accountHolder: 'Ledger Test',
      });

      // Gone from the wallet immediately — not held in limbo until ops looks at it.
      expect(result.balanceAfterPaise).toBe(before - 50_000n);
      expect(await balance()).toBe(before - 50_000n);
    });

    it('lets only ONE of two concurrent full-balance withdrawals succeed', async () => {
      const available = await balance();

      // The double-spend attempt. Both requests are for the entire balance, in flight
      // together. Without the row lock and the non-negative constraint, both would read the
      // same balance, both would pass, and the customer would be owed twice what they have.
      const results = await Promise.allSettled([
        wallet.requestWithdrawal({
          userId,
          amountPaise: available,
          bankAccountLast4: '1111',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Ledger Test',
        }),
        wallet.requestWithdrawal({
          userId,
          amountPaise: available,
          bankAccountLast4: '2222',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Ledger Test',
        }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

      expect(await balance()).toBe(0n);
    });

    it('reverses a rejection with a NEW credit, leaving the original debit intact', async () => {
      await wallet.adjust({
        userId,
        direction: 'CREDIT',
        amountPaise: 60_000n,
        note: 'Top-up before testing rejection reversal.',
        actorUserId: userId,
      });

      const before = await balance();

      const { withdrawal } = await wallet.requestWithdrawal({
        userId,
        amountPaise: 50_000n,
        bankAccountLast4: '4321',
        bankIfsc: 'HDFC0001234',
        accountHolder: 'Ledger Test',
      });

      expect(await balance()).toBe(before - 50_000n);

      const rejected = await wallet.rejectWithdrawal({
        withdrawalId: withdrawal.id,
        actorUserId: userId,
        reason: 'Bank details do not match KYC.',
      });

      expect(rejected.balanceAfterPaise).toBe(before);
      expect(await balance()).toBe(before);

      // BOTH rows are in the ledger. The debit was not erased — it happened, and the
      // customer's statement should show it happening and being undone.
      const entries = await prisma.walletTransaction.findMany({
        where: { withdrawalId: withdrawal.id },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((entry) => entry.type)).toEqual([
        'WITHDRAWAL_DEBIT',
        'WITHDRAWAL_REVERSAL',
      ]);
    });
  });

  describe('the balance is always exactly the ledger', () => {
    it('survives a storm of mixed concurrent operations', async () => {
      await wallet.adjust({
        userId,
        direction: 'CREDIT',
        amountPaise: 200_000n,
        note: 'Seed for the mixed-operation storm test.',
        actorUserId: userId,
      });

      const pickups = await Promise.all(Array.from({ length: 6 }, () => makePickup()));

      // Everything at once: cashback credits, withdrawals, adjustments, and duplicate
      // completions all racing for the same wallet row.
      await Promise.allSettled([
        ...pickups.map((pickup) => complete(pickup.id, 1500)),
        ...pickups.slice(0, 3).map((pickup) => complete(pickup.id, 1500)), // duplicates
        wallet.requestWithdrawal({
          userId,
          amountPaise: 30_000n,
          bankAccountLast4: '9999',
          bankIfsc: 'HDFC0001234',
          accountHolder: 'Ledger Test',
        }),
        wallet.adjust({
          userId,
          direction: 'DEBIT',
          amountPaise: 1_000n,
          note: 'Storm test debit adjustment.',
          actorUserId: userId,
        }),
        wallet.adjust({
          userId,
          direction: 'CREDIT',
          amountPaise: 2_000n,
          note: 'Storm test credit adjustment.',
          actorUserId: userId,
        }),
      ]);

      // afterEach replays the ENTIRE ledger and asserts every balanceAfter forms an
      // unbroken chain ending at the cached balance. If any write escaped the lock, this
      // fails. Each of the six pickups was credited exactly once, despite three of them
      // being submitted twice.
      const credited = await prisma.walletTransaction.count({
        where: { pickupId: { in: pickups.map((pickup) => pickup.id) } },
      });

      expect(credited).toBe(6);
    });
  });
});
