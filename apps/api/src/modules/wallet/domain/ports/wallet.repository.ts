import { type WeighedItem } from '../money';
import { type WalletTxnDirection, type WalletTxnType } from '../ledger';
import { type WithdrawalStatus } from '../withdrawal-state-machine';

export interface WalletSummary {
  id: string;
  userId: string;
  balancePaise: bigint;
  currency: string;
}

export interface LedgerRow {
  id: string;
  type: WalletTxnType;
  direction: WalletTxnDirection;
  amountPaise: bigint;
  balanceAfterPaise: bigint;
  pickupId: string | null;
  withdrawalId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface CompletedPickupResult {
  pickupId: string;
  totalWeightGrams: number;
  totalPaise: number;
  balanceAfterPaise: bigint;
  transactionId: string;
  lines: { paperType: string; weightGrams: number; ratePerKgPaise: number; amountPaise: number }[];
}

export interface WithdrawalRow {
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
}

export interface WalletRepository {
  /** Creates the wallet on first access. Every user has one; it just may not exist yet. */
  ensureWallet(userId: string): Promise<WalletSummary>;

  findByUserId(userId: string): Promise<WalletSummary | null>;

  listTransactions(walletId: string, limit: number): Promise<LedgerRow[]>;

  /** Every entry, oldest first. For reconciliation — not for a UI. */
  allTransactionsForReconciliation(
    walletId: string,
  ): Promise<Pick<LedgerRow, 'direction' | 'amountPaise' | 'balanceAfterPaise'>[]>;

  /**
   * THE critical operation of this phase.
   *
   * In ONE database transaction: mark the pickup COMPLETED, write its weighed items,
   * append exactly one CREDIT to the ledger, and update the cached wallet balance. It
   * must never partially succeed — a pickup marked complete with no credit means an
   * unpaid customer; a credit with no pickup means money invented from nothing.
   *
   * The pickup's status is changed with a CONDITIONAL update (WHERE status = 'ASSIGNED'),
   * and `wallet_transactions.pickupId` is UNIQUE, so a double-submit loses the race at
   * the database rather than in a code path someone can refactor around.
   */
  completePickupWithCashback(input: {
    pickupId: string;
    userId: string;
    rateCardId: string;
    items: readonly WeighedItem[];
  }): Promise<CompletedPickupResult>;

  /**
   * Debits the wallet AND creates the withdrawal request, atomically.
   *
   * Debiting at REQUEST time, not at approval, is the whole design. If the money stayed
   * in the wallet until ops got round to approving, a customer could request their full
   * balance twice — or spend it in the Phase 8 marketplace while a payout was pending —
   * and one of those two promises would have to be broken.
   */
  requestWithdrawal(input: {
    userId: string;
    amountPaise: bigint;
    bankAccountLast4: string;
    bankIfsc: string;
    accountHolder: string;
  }): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }>;

  /** Approve: a status change only. The money already left the wallet at request time. */
  approveWithdrawal(input: { withdrawalId: string; actorUserId: string }): Promise<WithdrawalRow>;

  /**
   * Reject: status change + a REVERSAL CREDIT, atomically.
   *
   * A new row, never an edit of the original debit — the ledger is append-only and the
   * database enforces it with a trigger.
   */
  rejectWithdrawal(input: {
    withdrawalId: string;
    actorUserId: string;
    reason: string;
  }): Promise<{ withdrawal: WithdrawalRow; balanceAfterPaise: bigint }>;

  markWithdrawalPaid(input: {
    withdrawalId: string;
    actorUserId: string;
    paymentRef: string;
  }): Promise<WithdrawalRow>;

  findWithdrawalById(id: string): Promise<WithdrawalRow | null>;
  listWithdrawalsForUser(userId: string): Promise<WithdrawalRow[]>;
  listWithdrawalsByStatus(status: WithdrawalStatus | null): Promise<WithdrawalRow[]>;

  /** Ops correction. Always a new ledger row, always attributed to a person. */
  adjust(input: {
    userId: string;
    direction: WalletTxnDirection;
    amountPaise: bigint;
    note: string;
    actorUserId: string;
  }): Promise<{ balanceAfterPaise: bigint }>;
}

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');
