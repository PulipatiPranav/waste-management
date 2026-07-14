import {
  ConflictError,
  DomainError,
  InvariantViolationError,
  NotFoundError,
} from '@/shared/domain/errors/domain.error';

/**
 * Names both the current state and the attempted action.
 *
 * "Cannot pause a CANCELLED subscription" is actionable in a support ticket;
 * "Invalid state" is not.
 */
export class InvalidTransitionError extends ConflictError {
  override readonly code = 'INVALID_SUBSCRIPTION_TRANSITION';

  constructor(
    readonly from: string,
    readonly action: string,
  ) {
    super(`Cannot ${action.toLowerCase().replace('_', ' ')} a subscription that is ${from}.`);
  }
}

export class SubscriptionNotFoundError extends NotFoundError {
  override readonly code = 'SUBSCRIPTION_NOT_FOUND';

  constructor() {
    super('Subscription not found');
  }
}

export class EditionNotFoundError extends NotFoundError {
  override readonly code = 'EDITION_NOT_FOUND';

  constructor() {
    super('Newspaper edition not found');
  }
}

/** The customer's address is outside the edition's delivery footprint. */
export class PincodeNotServicedError extends DomainError {
  readonly code = 'PINCODE_NOT_SERVICED';

  constructor(pincode: string) {
    super(`This newspaper is not delivered to ${pincode} yet.`);
  }
}

export class EditionUnavailableError extends DomainError {
  readonly code = 'EDITION_UNAVAILABLE';

  constructor() {
    super('This newspaper edition is not currently available for subscription.');
  }
}

/** Backdating would silently rewrite an invoice that has already been issued. */
export class BackdatedChangeError extends InvariantViolationError {
  override readonly code = 'BACKDATED_CHANGE';

  constructor(message = 'A subscription change cannot be backdated.') {
    super(message);
  }
}

export class DuplicateSubscriptionError extends ConflictError {
  override readonly code = 'DUPLICATE_SUBSCRIPTION';

  constructor() {
    super('You already have an active subscription to this newspaper edition.');
  }
}
