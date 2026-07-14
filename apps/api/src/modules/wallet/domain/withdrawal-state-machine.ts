import { ConflictError } from '@/shared/domain/errors/domain.error';

export const WITHDRAWAL_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_ACTIONS = ['APPROVE', 'REJECT', 'MARK_PAID'] as const;
export type WithdrawalAction = (typeof WITHDRAWAL_ACTIONS)[number];

export class InvalidWithdrawalTransitionError extends ConflictError {
  override readonly code = 'INVALID_WITHDRAWAL_TRANSITION';

  constructor(from: WithdrawalStatus, action: WithdrawalAction) {
    super(`Cannot ${action.toLowerCase().replace('_', ' ')} a withdrawal that is ${from}.`);
  }
}

/**
 * The payout lifecycle. Two separate human actions, on purpose.
 *
 *   REQUESTED --approve--> APPROVED --mark paid--> PAID
 *            \--reject--> REJECTED (debit reversed by a new CREDIT row)
 *
 * NOTHING here disburses money. `APPROVE` records that ops agreed to pay; `MARK_PAID`
 * records that a human confirmed the bank transfer actually went out. Collapsing them
 * into one step would mean the system claims money has been sent when it might not have
 * been — and reconciling that afterwards, against a bank statement, is exactly the mess
 * this separation avoids.
 *
 * Automating disbursement is a COMPLIANCE decision (RBI PPI licensing), not an
 * engineering one. See the note in the README. Do not add an auto-payout transition here
 * without that question being answered by someone qualified to answer it.
 */
const TRANSITIONS: Readonly<
  Record<WithdrawalStatus, Readonly<Record<WithdrawalAction, WithdrawalStatus | null>>>
> = {
  REQUESTED: {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    // Cannot skip approval. That is the whole control.
    MARK_PAID: null,
  },
  APPROVED: {
    APPROVE: null,
    // Deliberately NOT reversible: once ops has approved, the money may already be in
    // flight at the bank. Reversing it in the system while it lands in the customer's
    // account would double-pay. A mistake here is fixed by an ADJUSTMENT entry, visibly.
    REJECT: null,
    MARK_PAID: 'PAID',
  },
  REJECTED: { APPROVE: null, REJECT: null, MARK_PAID: null },
  PAID: { APPROVE: null, REJECT: null, MARK_PAID: null },
};

export function canTransition(from: WithdrawalStatus, action: WithdrawalAction): boolean {
  return TRANSITIONS[from][action] !== null;
}

/** @throws {InvalidWithdrawalTransitionError} */
export function applyWithdrawalTransition(
  from: WithdrawalStatus,
  action: WithdrawalAction,
): WithdrawalStatus {
  const next = TRANSITIONS[from][action];

  if (next === null) {
    throw new InvalidWithdrawalTransitionError(from, action);
  }

  return next;
}
