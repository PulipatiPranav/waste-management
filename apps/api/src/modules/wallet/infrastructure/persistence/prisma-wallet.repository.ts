import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type WalletTxnDirection, type WalletTxnType } from '../../domain/ledger';
import { WalletLedgerWriter } from './wallet-ledger.writer';
import { calculateCashback, type PaperType, type WeighedItem } from '../../domain/money';
import {
  type CompletedPickupResult,
  type LedgerRow,
  type WalletRepository,
  type WalletSummary,
  type WithdrawalRow,
} from '../../domain/ports/wallet.repository';
import {
  applyWithdrawalTransition,
  type WithdrawalStatus,
} from '../../domain/withdrawal-state-machine';

/** Any Prisma client — the real one, or a transaction handle. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaWalletRepository implements WalletRepository {
  private readonly logger = new Logger(PrismaWalletRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    // The ledger append/lock primitive lives in one place (shared with the marketplace's
    // order-confirmation transaction). This repository owns the wallet-specific flows;
    // WalletLedgerWriter owns "how a ledger entry is written safely".
    private readonly ledger: WalletLedgerWriter,
  ) {}

  // -------------------------------------------------------------------------
  // The core primitive: delegated to WalletLedgerWriter so there is exactly one
  // implementation of "lock a wallet" and "append an entry" in the codebase.
  // -------------------------------------------------------------------------

  private lockWallet(tx: Tx, walletId: string): Promise<bigint> {
    return this.ledger.lockWallet(tx, walletId);
  }

  private appendEntry(
    tx: Tx,
    input: {
      walletId: string;
      currentBalance: bigint;
      type: WalletTxnType;
      direction: WalletTxnDirection;
      amountPaise: bigint;
      pickupId?: string | undefined;
      withdrawalId?: string | undefined;
      note?: string | undefined;
      actorUserId?: string | undefined;
    },
  ): Promise<{ transactionId: string; balanceAfterPaise: bigint }> {
    return this.ledger.append(tx, input);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async ensureWallet(userId: string): Promise<WalletSummary> {
    // Upsert, not find-then-create: two concurrent first-time reads would both see "no
    // wallet" and both insert, and the unique index would 500 one of them.
    const row = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    return this.toSummary(row);
  }

  async findByUserId(userId: string): Promise<WalletSummary | null> {
    const row = await this.prisma.wallet.findUnique({ where: { userId } });
    return row === null ? null : this.toSummary(row);
  }

  async listTransactions(walletId: string, limit: number): Promise<LedgerRow[]> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: { walletId },
      // By `seq`, never by `createdAt` — see the note on the column. Newest first here.
      orderBy: { seq: 'desc' },
      take: limit,
    });

    return rows.map((row) => this.toLedgerRow(row));
  }

  async allTransactionsForReconciliation(
    walletId: string,
  ): Promise<Pick<LedgerRow, 'direction' | 'amountPaise' | 'balanceAfterPaise'>[]> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: { walletId },
      // THE ordering that makes reconciliation trustworthy: `seq` is assigned at INSERT,
      // under the wallet row lock, so per wallet it is the true commit order.
      //
      // Ordering by `createdAt` here was a real bug: it is the TRANSACTION START time, and
      // a transaction that starts earlier can commit later (it waits on the lock). Replay
      // in timestamp order then reports a break in a perfectly correct ledger — or hides a
      // real one. See the regression test in wallet-ledger.e2e-spec.ts.
      orderBy: { seq: 'asc' },
      select: { direction: true, amountPaise: true, balanceAfterPaise: true },
    });

    return rows.map((row) => ({
      direction: row.direction,
      amountPaise: row.amountPaise,
      balanceAfterPaise: row.balanceAfterPaise,
    }));
  }

  // -------------------------------------------------------------------------
  // Pickup completion — the money path
  // -------------------------------------------------------------------------

  /**
   * ONE transaction: complete the pickup, write its items, credit the wallet.
   *
   * Every step below is inside it. If any one fails, ALL of them are rolled back — there
   * is no state in which the customer's pickup is marked complete but their wallet was
   * never credited, and none in which money appears without a pickup behind it.
   */
  async completePickupWithCashback(input: {
    pickupId: string;
    userId: string;
    rateCardId: string;
    items: readonly WeighedItem[];
  }): Promise<CompletedPickupResult> {
    // Priced OUTSIDE the transaction: it is pure arithmetic, and holding a row lock while
    // doing it would lengthen the lock for no reason.
    const breakdown = calculateCashback(input.items);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId: input.userId },
          update: {},
          create: { userId: input.userId },
          select: { id: true },
        });

        // Serialise concurrent credits to this wallet. Everything after this point sees a
        // balance nobody else can change until we commit.
        const balance = await this.lockWallet(tx, wallet.id);

        // CONDITIONAL: only an ASSIGNED pickup can be completed. A double-submit from a
        // partner on a flaky network finds count === 0 here and the whole transaction is
        // abandoned — rather than crediting the wallet a second time.
        const claimed = await tx.pickupRequest.updateMany({
          where: { id: input.pickupId, status: 'ASSIGNED' },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        if (claimed.count === 0) {
          throw new ConflictError('This pickup has already been completed or was cancelled.');
        }

        await tx.pickupItem.createMany({
          data: breakdown.lines.map((line) => ({
            pickupId: input.pickupId,
            paperType: line.paperType,
            weightGrams: line.weightGrams,
            ratePerKgPaiseAtPickup: line.ratePerKgPaise,
            rateCardId: input.rateCardId,
            amountPaise: line.amountPaise,
          })),
        });

        // A zero-value pickup (all paper types at rate 0, or nothing worth anything) still
        // completes — it just does not produce a ledger entry, because a 0-paise
        // transaction is noise in a ledger and the amount > 0 check constraint forbids it.
        if (breakdown.totalPaise === 0) {
          return {
            pickupId: input.pickupId,
            totalWeightGrams: breakdown.totalWeightGrams,
            totalPaise: 0,
            balanceAfterPaise: balance,
            transactionId: '',
            lines: breakdown.lines,
          };
        }

        const { transactionId, balanceAfterPaise } = await this.appendEntry(tx, {
          walletId: wallet.id,
          currentBalance: balance,
          type: 'PICKUP_CASHBACK',
          direction: 'CREDIT',
          amountPaise: BigInt(breakdown.totalPaise),
          // UNIQUE in the schema. The last line of defence against paying twice for one
          // pickup: even if every check above were bypassed, this insert would fail.
          pickupId: input.pickupId,
        });

        return {
          pickupId: input.pickupId,
          totalWeightGrams: breakdown.totalWeightGrams,
          totalPaise: breakdown.totalPaise,
          balanceAfterPaise,
          transactionId,
          lines: breakdown.lines,
        };
      });
    } catch (error) {
      // P2002 on `pickupId` means a cashback entry for this pickup already exists — two
      // requests raced past the status check. The database caught it; report it as the
      // conflict it is rather than a 500.
      if (isUniqueViolation(error)) {
        this.logger.warn(
          `Double cashback prevented for pickup ${input.pickupId}: the ledger's unique pickupId index rejected the second entry.`,
        );
        throw new ConflictError('This pickup has already been completed.');
      }

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Withdrawals
  // -------------------------------------------------------------------------

  async requestWithdrawal(input: {
    userId: string;
    amountPaise: bigint;
    bankAccountLast4: string;
    bankIfsc: string;
    accountHolder: string;
  }): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true },
      });

      const balance = await this.lockWallet(tx, wallet.id);

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          userId: input.userId,
          amountPaise: input.amountPaise,
          bankAccountLast4: input.bankAccountLast4,
          bankIfsc: input.bankIfsc,
          accountHolder: input.accountHolder,
        },
      });

      // The money leaves the wallet NOW. Under the same lock, so two concurrent requests
      // for the full balance cannot both succeed — the second sees the debited balance and
      // applyEntry throws InsufficientBalanceError.
      const { balanceAfterPaise } = await this.appendEntry(tx, {
        walletId: wallet.id,
        currentBalance: balance,
        type: 'WITHDRAWAL_DEBIT',
        direction: 'DEBIT',
        amountPaise: input.amountPaise,
        withdrawalId: withdrawal.id,
        actorUserId: input.userId,
      });

      return { withdrawal: this.toWithdrawal(withdrawal), balanceAfterPaise };
    });
  }

  async approveWithdrawal(input: {
    withdrawalId: string;
    actorUserId: string;
  }): Promise<WithdrawalRow> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadWithdrawalForUpdate(tx, input.withdrawalId);
      const next = applyWithdrawalTransition(current.status, 'APPROVE');

      // Status only. The money already left the wallet when the request was made — this
      // records that ops agreed to send it, NOT that it has been sent.
      const updated = await tx.withdrawalRequest.update({
        where: { id: input.withdrawalId },
        data: {
          status: next,
          reviewedByUserId: input.actorUserId,
          reviewedAt: new Date(),
        },
      });

      return this.toWithdrawal(updated);
    });
  }

  async rejectWithdrawal(input: {
    withdrawalId: string;
    actorUserId: string;
    reason: string;
  }): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadWithdrawalForUpdate(tx, input.withdrawalId);
      const next = applyWithdrawalTransition(current.status, 'REJECT');

      const balance = await this.lockWallet(tx, current.walletId);

      const updated = await tx.withdrawalRequest.update({
        where: { id: input.withdrawalId },
        data: {
          status: next,
          reviewedByUserId: input.actorUserId,
          reviewedAt: new Date(),
          rejectionReason: input.reason,
        },
      });

      // A NEW ledger row that puts the money back. NOT an edit or deletion of the original
      // debit — the ledger is append-only and Postgres enforces it with a trigger. The
      // customer's statement shows both, which is exactly what they should see.
      const { balanceAfterPaise } = await this.appendEntry(tx, {
        walletId: current.walletId,
        currentBalance: balance,
        type: 'WITHDRAWAL_REVERSAL',
        direction: 'CREDIT',
        amountPaise: current.amountPaise,
        withdrawalId: current.id,
        note: `Withdrawal rejected: ${input.reason}`,
        actorUserId: input.actorUserId,
      });

      return { withdrawal: this.toWithdrawal(updated), balanceAfterPaise };
    });
  }

  async markWithdrawalPaid(input: {
    withdrawalId: string;
    actorUserId: string;
    paymentRef: string;
  }): Promise<WithdrawalRow> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.loadWithdrawalForUpdate(tx, input.withdrawalId);
      const next = applyWithdrawalTransition(current.status, 'MARK_PAID');

      // No ledger entry: the money left the wallet at request time. This records that a
      // HUMAN confirmed the bank transfer actually went out.
      const updated = await tx.withdrawalRequest.update({
        where: { id: input.withdrawalId },
        data: {
          status: next,
          paidAt: new Date(),
          paymentRef: input.paymentRef,
          reviewedByUserId: input.actorUserId,
        },
      });

      return this.toWithdrawal(updated);
    });
  }

  async findWithdrawalById(id: string): Promise<WithdrawalRow | null> {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    return row === null ? null : this.toWithdrawal(row);
  }

  async listWithdrawalsForUser(userId: string): Promise<WithdrawalRow[]> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toWithdrawal(row));
  }

  async listWithdrawalsByStatus(status: WithdrawalStatus | null): Promise<WithdrawalRow[]> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      where: status === null ? {} : { status },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => this.toWithdrawal(row));
  }

  async adjust(input: {
    userId: string;
    direction: WalletTxnDirection;
    amountPaise: bigint;
    note: string;
    actorUserId: string;
  }): Promise<{ balanceAfterPaise: bigint }> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true },
      });

      const balance = await this.lockWallet(tx, wallet.id);

      const { balanceAfterPaise } = await this.appendEntry(tx, {
        walletId: wallet.id,
        currentBalance: balance,
        type: 'ADJUSTMENT',
        direction: input.direction,
        amountPaise: input.amountPaise,
        note: input.note,
        // Always attributed. An unattributable balance change in a financial system is
        // indistinguishable from fraud.
        actorUserId: input.actorUserId,
      });

      return { balanceAfterPaise };
    });
  }

  // -------------------------------------------------------------------------

  private async loadWithdrawalForUpdate(
    tx: Tx,
    id: string,
  ): Promise<{ id: string; walletId: string; amountPaise: bigint; status: WithdrawalStatus }> {
    // FOR UPDATE on the withdrawal too: two ops staff clicking approve and reject at the
    // same moment must not both succeed.
    const rows = await tx.$queryRaw<
      { id: string; walletId: string; amountPaise: bigint; status: WithdrawalStatus }[]
    >`
      SELECT "id", "walletId", "amountPaise", "status"
      FROM "withdrawal_requests" WHERE "id" = ${id}::uuid FOR UPDATE
    `;

    const row = rows[0];

    if (row === undefined) {
      throw new NotFoundError('Withdrawal request not found');
    }

    return row;
  }

  private toSummary(row: {
    id: string;
    userId: string;
    balancePaise: bigint;
    currency: string;
  }): WalletSummary {
    return {
      id: row.id,
      userId: row.userId,
      balancePaise: row.balancePaise,
      currency: row.currency,
    };
  }

  private toLedgerRow(row: {
    id: string;
    type: WalletTxnType;
    direction: WalletTxnDirection;
    amountPaise: bigint;
    balanceAfterPaise: bigint;
    pickupId: string | null;
    withdrawalId: string | null;
    note: string | null;
    createdAt: Date;
  }): LedgerRow {
    return { ...row };
  }

  private toWithdrawal(row: {
    id: string;
    userId: string;
    walletId: string;
    amountPaise: bigint;
    status: WithdrawalStatus;
    bankAccountLast4: string;
    bankIfsc: string;
    accountHolder: string;
    rejectionReason: string | null;
    paymentRef: string | null;
    createdAt: Date;
  }): WithdrawalRow {
    return { ...row };
  }
}

/** Prisma's unique-constraint error. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export type { PaperType };
