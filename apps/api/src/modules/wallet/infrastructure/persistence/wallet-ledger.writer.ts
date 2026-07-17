import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { applyEntry, type WalletTxnDirection, type WalletTxnType } from '../../domain/ledger';

/** Any Prisma client — the real one, or a transaction handle. */
type Tx = Prisma.TransactionClient;

/**
 * The append-one-ledger-entry primitive, extracted so it can be reused ACROSS modules
 * inside a caller's transaction — specifically, so the Phase 8 marketplace can debit the
 * wallet in the SAME transaction that decrements inventory and captures the gateway payment.
 *
 * Every ledger invariant lives here, in one place: the wallet row lock that serialises
 * concurrent writers (without it, two credits read the same balance and one silently
 * vanishes), the pure `applyEntry` that computes balanceAfter and refuses an overdraw, and
 * the paired write of the ledger row plus the cached balance. A caller in another module
 * gets all of that for free by handing this its transaction handle — it does NOT get to
 * reimplement "debit a wallet", which is exactly the kind of money code that must never be
 * copied.
 *
 * The wallet repository uses this too, so there is a single implementation of the primitive
 * rather than two that can drift.
 */
@Injectable()
export class WalletLedgerWriter {
  /**
   * Locks the wallet row and returns its balance. `SELECT ... FOR UPDATE` is the whole
   * concurrency story: Postgres serialises writers on this row, so the second caller waits
   * and then reads the balance the first actually committed. Must be called INSIDE a
   * transaction — the lock releases at commit.
   */
  async lockWallet(tx: Tx, walletId: string): Promise<bigint> {
    const rows = await tx.$queryRaw<{ balancePaise: bigint }[]>`
      SELECT "balancePaise" FROM "wallets" WHERE "id" = ${walletId}::uuid FOR UPDATE
    `;

    const row = rows[0];
    if (row === undefined) {
      throw new NotFoundError('Wallet not found');
    }
    return row.balancePaise;
  }

  /** Upserts the wallet (every user has one; it may just not exist yet) and returns its id. */
  async ensureWalletId(tx: Tx, userId: string): Promise<string> {
    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { id: true },
    });
    return wallet.id;
  }

  /**
   * Appends one entry and updates the cached balance, atomically with the caller's other
   * writes. The caller supplies the transaction AND must already hold the wallet lock.
   *
   * @throws {InsufficientBalanceError} (via applyEntry) when a debit would overdraw.
   */
  async append(
    tx: Tx,
    input: {
      walletId: string;
      currentBalance: bigint;
      type: WalletTxnType;
      direction: WalletTxnDirection;
      amountPaise: bigint;
      pickupId?: string | undefined;
      withdrawalId?: string | undefined;
      orderId?: string | undefined;
      note?: string | undefined;
      actorUserId?: string | undefined;
    },
  ): Promise<{ transactionId: string; balanceAfterPaise: bigint }> {
    const entry = applyEntry(input.currentBalance, {
      type: input.type,
      direction: input.direction,
      amountPaise: input.amountPaise,
    });

    const created = await tx.walletTransaction.create({
      data: {
        walletId: input.walletId,
        type: input.type,
        direction: input.direction,
        amountPaise: input.amountPaise,
        balanceAfterPaise: entry.balanceAfterPaise,
        pickupId: input.pickupId ?? null,
        withdrawalId: input.withdrawalId ?? null,
        orderId: input.orderId ?? null,
        note: input.note ?? null,
        actorUserId: input.actorUserId ?? null,
      },
      select: { id: true },
    });

    await tx.wallet.update({
      where: { id: input.walletId },
      data: { balancePaise: entry.balanceAfterPaise },
    });

    return { transactionId: created.id, balanceAfterPaise: entry.balanceAfterPaise };
  }

  /**
   * Debits the wallet for the wallet portion of a marketplace order, inside the caller's
   * transaction. Ensures the wallet, locks it, and appends an ORDER_PAYMENT. The partial
   * unique index on (orderId) WHERE type='ORDER_PAYMENT' means a replayed confirmation that
   * reaches here a second time fails at the database rather than double-charging.
   *
   * @throws {InsufficientBalanceError} if the balance moved below the wallet portion since
   *         checkout — the signal the whole order confirmation must roll back and refund.
   */
  async debitForOrder(
    tx: Tx,
    input: { userId: string; orderId: string; amountPaise: bigint; actorUserId: string },
  ): Promise<{ transactionId: string; balanceAfterPaise: bigint }> {
    const walletId = await this.ensureWalletId(tx, input.userId);
    const balance = await this.lockWallet(tx, walletId);

    return this.append(tx, {
      walletId,
      currentBalance: balance,
      type: 'ORDER_PAYMENT',
      direction: 'DEBIT',
      amountPaise: input.amountPaise,
      orderId: input.orderId,
      actorUserId: input.actorUserId,
    });
  }

  /**
   * Credits the wallet back the ORDER_PAYMENT amount when a confirmed order is cancelled. A
   * NEW row (ORDER_REFUND), never an edit of the debit — the ledger is append-only.
   */
  async refundForOrder(
    tx: Tx,
    input: {
      userId: string;
      orderId: string;
      amountPaise: bigint;
      note: string;
      actorUserId: string;
    },
  ): Promise<{ transactionId: string; balanceAfterPaise: bigint }> {
    const walletId = await this.ensureWalletId(tx, input.userId);
    const balance = await this.lockWallet(tx, walletId);

    return this.append(tx, {
      walletId,
      currentBalance: balance,
      type: 'ORDER_REFUND',
      direction: 'CREDIT',
      amountPaise: input.amountPaise,
      orderId: input.orderId,
      note: input.note,
      actorUserId: input.actorUserId,
    });
  }
}
