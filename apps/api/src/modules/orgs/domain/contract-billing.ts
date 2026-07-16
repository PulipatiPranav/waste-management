import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { InvariantViolationError } from '@/shared/domain/errors/domain.error';

export type ContractType = 'FLAT_MONTHLY' | 'PER_KG';

export interface ContractTerms {
  type: ContractType;
  /** Integer paise. Set for FLAT_MONTHLY. */
  flatAmountPaise: number | null;
  /** Integer paise PER KG. Set for PER_KG. */
  perKgRatePaise: number | null;
}

export interface InvoiceComputation {
  amountPaise: number;
  /** Echoed back so the invoice can snapshot exactly what it billed against. */
  recycledGrams: number;
}

const GRAMS_PER_KG = 1000;

/**
 * Computes an invoice amount from a contract and the org's confirmed-recycled weight.
 *
 * A pure function of the terms and the weight — no clock, no database — so the two billing
 * models can be tested exhaustively at their boundaries, which is exactly where a billing bug
 * hides (a per-kg contract that rounds the wrong way overcharges every org, every month).
 *
 * PER_KG rounds HALF UP, ONCE, to whole paise — the same single-rounding-point discipline the
 * cashback ledger uses. `grams × ratePerKgPaise / 1000` is fractional in general, so a rule is
 * unavoidable; making it explicit and singular is what keeps the invoice reconcilable against
 * the recycled weight it cites.
 */
export function computeInvoiceAmount(
  terms: ContractTerms,
  recycledGrams: number,
): InvoiceComputation {
  if (!Number.isInteger(recycledGrams) || recycledGrams < 0) {
    throw new InvariantViolationError('Recycled weight must be a non-negative integer of grams.');
  }

  if (terms.type === 'FLAT_MONTHLY') {
    if (terms.flatAmountPaise === null || terms.flatAmountPaise < 0) {
      throw new InvariantViolationError(
        'A flat-monthly contract needs a non-negative flat amount.',
      );
    }

    // Volume-independent by definition: the org pays the same whether they recycled 5 kg or
    // 5 tonnes. The recycled weight is still recorded on the invoice, for the ESG story.
    return { amountPaise: terms.flatAmountPaise, recycledGrams };
  }

  if (terms.perKgRatePaise === null || terms.perKgRatePaise < 0) {
    throw new InvariantViolationError('A per-kg contract needs a non-negative per-kg rate.');
  }

  // Integer half-up on `grams × rate / 1000`. No float touches this.
  const amountPaise = Math.floor(
    (recycledGrams * terms.perKgRatePaise + GRAMS_PER_KG / 2) / GRAMS_PER_KG,
  );

  return { amountPaise, recycledGrams };
}

export interface BillingPeriod {
  label: string;
  start: Day;
  end: Day;
}

/**
 * The billing period for a `YYYY-MM` month.
 *
 * Calendar months, aligned across all orgs, so every invoice for July covers the same window
 * and the ESG report period matches the invoice period exactly. Anniversary periods would give
 * as many billing calendars as there are orgs.
 */
export function monthlyPeriod(yearMonth: string): BillingPeriod {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth);

  if (match === null) {
    throw new InvariantViolationError(`Expected a YYYY-MM month, got: ${yearMonth}`);
  }

  const start = Day.of(Number(match[1]), Number(match[2]), 1);

  return { label: yearMonth, start, end: start.endOfMonth() };
}

/**
 * The set of `YYYY-MM` months a period spans (inclusive). Used to sum an org's recycling over
 * a quarter or year from the monthly impact cache.
 */
export function monthsInRange(fromYearMonth: string, toYearMonth: string): string[] {
  const from = monthlyPeriod(fromYearMonth).start;
  const to = monthlyPeriod(toYearMonth).start;

  if (to.isBefore(from)) {
    throw new InvariantViolationError('The period end month is before its start month.');
  }

  const months: string[] = [];
  for (let cursor = from; cursor.isOnOrBefore(to); cursor = cursor.addMonths(1)) {
    months.push(`${cursor.year}-${String(cursor.month).padStart(2, '0')}`);
  }

  return months;
}
