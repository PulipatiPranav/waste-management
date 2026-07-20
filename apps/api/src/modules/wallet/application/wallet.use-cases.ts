import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  NOTIFICATION_DISPATCHER,
  type NotificationDispatcher,
} from '@/modules/notifications/domain/ports/notification-dispatcher.port';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/domain/errors/domain.error';
import { InsufficientBalanceError, reconcile, type WalletTxnDirection } from '../domain/ledger';
import { paiseToRupees } from '../domain/money';
import {
  WALLET_REPOSITORY,
  type LedgerRow,
  type WalletRepository,
  type WalletSummary,
  type WithdrawalRow,
} from '../domain/ports/wallet.repository';
import { type WithdrawalStatus } from '../domain/withdrawal-state-machine';

/** Below this, a bank transfer costs more in fees and ops time than it moves. */
const MIN_WITHDRAWAL_PAISE = 10_000n; // ₹100

@Injectable()
export class WalletUseCases {
  private readonly logger = new Logger(WalletUseCases.name);

  constructor(
    @Inject(WALLET_REPOSITORY) private readonly wallet: WalletRepository,
    @Inject(NOTIFICATION_DISPATCHER) private readonly notifications: NotificationDispatcher,
  ) {}

  // --- Customer -------------------------------------------------------------

  /** Creates the wallet on first read. A customer always has one; it just may not exist yet. */
  getWallet(userId: string): Promise<WalletSummary> {
    return this.wallet.ensureWallet(userId);
  }

  async getTransactions(userId: string, limit: number): Promise<LedgerRow[]> {
    const wallet = await this.wallet.ensureWallet(userId);
    return this.wallet.listTransactions(wallet.id, limit);
  }

  /**
   * Request a payout to a bank account.
   *
   * The wallet is DEBITED HERE, not at approval. If the money stayed put until ops got
   * round to reviewing, a customer could request their whole balance twice (or spend it in
   * the Phase 8 marketplace with a payout pending) and one of those two promises would
   * have to be broken. The debit and the request row are written in one transaction, under
   * the wallet's row lock, so two concurrent requests cannot both pass the balance check.
   */
  async requestWithdrawal(input: {
    userId: string;
    amountPaise: bigint;
    bankAccountLast4: string;
    bankIfsc: string;
    accountHolder: string;
  }): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }> {
    if (input.amountPaise < MIN_WITHDRAWAL_PAISE) {
      throw new ConflictError(
        `The minimum withdrawal is ₹${Number(MIN_WITHDRAWAL_PAISE) / 100}. Below that, the bank fee costs more than the transfer moves.`,
      );
    }

    try {
      const result = await this.wallet.requestWithdrawal(input);

      this.logger.log(
        `Withdrawal ${result.withdrawal.id} requested: ${input.amountPaise} paise debited and held`,
      );

      return result;
    } catch (error) {
      // Surfaces as a clean 422 rather than a check-constraint 500. The DB would have
      // caught it too (wallets_balance_non_negative) — this is the same rule, said kindly.
      if (error instanceof InsufficientBalanceError) throw error;
      throw error;
    }
  }

  listWithdrawals(userId: string): Promise<WithdrawalRow[]> {
    return this.wallet.listWithdrawalsForUser(userId);
  }

  // --- Ops ------------------------------------------------------------------

  listWithdrawalQueue(status: WithdrawalStatus | null): Promise<WithdrawalRow[]> {
    return this.wallet.listWithdrawalsByStatus(status);
  }

  /**
   * Ops approves a payout.
   *
   * This does NOT send money. It records that a human agreed to. Sending is a separate,
   * later, also-human action (markPaid). Nothing in this system auto-disburses to a bank —
   * that is a compliance boundary (RBI PPI licensing), not an engineering preference. See
   * the README before you change it.
   */
  async approveWithdrawal(withdrawalId: string, actorUserId: string): Promise<WithdrawalRow> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);

    this.logger.log(`Withdrawal ${withdrawal.id} APPROVED by ${actorUserId}`);

    const updated = await this.wallet.approveWithdrawal({ withdrawalId, actorUserId });

    void this.notifications.dispatch({
      userId: withdrawal.userId,
      category: 'WITHDRAWAL_UPDATE',
      title: 'Withdrawal approved',
      body: `Your withdrawal of ₹${paiseToRupees(withdrawal.amountPaise)} has been approved and is being paid out.`,
      data: { type: 'withdrawal_update', withdrawalId, status: 'APPROVED' },
    });

    return updated;
  }

  /** Rejects and refunds — with a new CREDIT row, never by editing the debit. */
  async rejectWithdrawal(
    withdrawalId: string,
    actorUserId: string,
    reason: string,
  ): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }> {
    const withdrawal = await this.requireWithdrawal(withdrawalId);

    this.logger.log(`Withdrawal ${withdrawalId} REJECTED by ${actorUserId}: ${reason}`);

    const result = await this.wallet.rejectWithdrawal({ withdrawalId, actorUserId, reason });

    void this.notifications.dispatch({
      userId: withdrawal.userId,
      category: 'WITHDRAWAL_UPDATE',
      title: 'Withdrawal rejected',
      body: `Your withdrawal of ₹${paiseToRupees(withdrawal.amountPaise)} was rejected and refunded to your wallet. Reason: ${reason}`,
      data: { type: 'withdrawal_update', withdrawalId, status: 'REJECTED' },
    });

    return result;
  }

  /** A human confirms the bank transfer actually went out. */
  async markWithdrawalPaid(
    withdrawalId: string,
    actorUserId: string,
    paymentRef: string,
  ): Promise<WithdrawalRow> {
    await this.requireWithdrawal(withdrawalId);

    this.logger.log(`Withdrawal ${withdrawalId} marked PAID by ${actorUserId} (${paymentRef})`);

    return this.wallet.markWithdrawalPaid({ withdrawalId, actorUserId, paymentRef });
  }

  /** Ops correction. A new ledger row, always attributed to the person who made it. */
  async adjust(input: {
    targetUserId: string;
    direction: WalletTxnDirection;
    amountPaise: bigint;
    note: string;
    actorUserId: string;
  }): Promise<{ balanceAfterPaise: bigint }> {
    if (input.note.trim().length < 10) {
      // A one-word reason on a manual balance change is useless to whoever audits it in
      // six months — and a manual balance change with no explanation is indistinguishable
      // from fraud.
      throw new ConflictError(
        'An adjustment needs a real explanation (at least 10 characters). It will be read by an auditor.',
      );
    }

    this.logger.warn(
      `MANUAL ADJUSTMENT by ${input.actorUserId} on ${input.targetUserId}: ` +
        `${input.direction} ${input.amountPaise} paise — ${input.note}`,
    );

    return this.wallet.adjust({
      userId: input.targetUserId,
      direction: input.direction,
      amountPaise: input.amountPaise,
      note: input.note,
      actorUserId: input.actorUserId,
    });
  }

  /**
   * Replays a wallet's whole ledger and checks it against the cached balance.
   *
   * The wallet's `balancePaise` is a CACHE; the ledger is the truth. This is what proves
   * they still agree, and it is exactly the tool support needs when a customer asks "why
   * does my wallet say ₹240". If it ever returns ok: false, a write got past the row lock
   * and the balance is not trustworthy — which is worth knowing immediately rather than at
   * audit time.
   */
  async reconcileWallet(userId: string): Promise<{
    ok: boolean;
    cachedBalancePaise: bigint;
    ledgerBalancePaise: bigint;
    entryCount: number;
    brokenAtIndex: number | null;
  }> {
    const wallet = await this.wallet.findByUserId(userId);

    if (wallet === null) {
      throw new NotFoundError('Wallet not found');
    }

    const entries = await this.wallet.allTransactionsForReconciliation(wallet.id);
    const result = reconcile(entries, wallet.balancePaise);

    if (!result.ok) {
      this.logger.error(
        `LEDGER MISMATCH for wallet ${wallet.id}: cached ${wallet.balancePaise}, ledger says ` +
          `${result.computedBalancePaise}. A write escaped the row lock.`,
      );
    }

    return {
      ok: result.ok,
      cachedBalancePaise: wallet.balancePaise,
      ledgerBalancePaise: result.computedBalancePaise,
      entryCount: entries.length,
      brokenAtIndex: result.brokenAtIndex,
    };
  }

  /** Support lookup: any user's wallet. Staff only — guarded at the controller. */
  async getWalletForStaff(userId: string): Promise<WalletSummary> {
    const wallet = await this.wallet.findByUserId(userId);

    if (wallet === null) {
      throw new NotFoundError('This user has no wallet yet.');
    }

    return wallet;
  }

  async getTransactionsForStaff(userId: string, limit: number): Promise<LedgerRow[]> {
    const wallet = await this.getWalletForStaff(userId);
    return this.wallet.listTransactions(wallet.id, limit);
  }

  private async requireWithdrawal(id: string): Promise<WithdrawalRow> {
    const withdrawal = await this.wallet.findWithdrawalById(id);

    if (withdrawal === null) {
      throw new NotFoundError('Withdrawal request not found');
    }

    return withdrawal;
  }

  /** Ownership check for a customer reading their own withdrawal. */
  async getWithdrawalForUser(userId: string, id: string): Promise<WithdrawalRow> {
    const withdrawal = await this.requireWithdrawal(id);

    if (withdrawal.userId !== userId) {
      throw new ForbiddenError('That withdrawal is not yours.');
    }

    return withdrawal;
  }
}
