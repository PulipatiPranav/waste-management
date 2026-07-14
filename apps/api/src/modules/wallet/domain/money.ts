/**
 * The money primitives. Pure integers, no floats, no Decimal, no library.
 *
 * Every amount in this system is INTEGER PAISE and every weight is INTEGER GRAMS.
 * See the convention note at the top of schema.prisma for why.
 */

/** Grams per kilogram. Named, because a bare `1000` in a money formula is a landmine. */
const GRAMS_PER_KG = 1000;

export const PAPER_TYPES = ['NEWSPAPER', 'MAGAZINE', 'OFFICE_PAPER', 'CARDBOARD', 'OTHER'] as const;

export type PaperType = (typeof PAPER_TYPES)[number];

/**
 * THE rounding rule, and the ONLY place in the entire money path where rounding happens.
 *
 * `weightGrams × ratePerKgPaise / 1000` is fractional in general — 1235 g at 1499
 * paise/kg is 1851.265 paise — so rounding is unavoidable. What IS avoidable is rounding
 * in several places, or differently in different places, which is how a cashback system
 * ends up paying out a total that does not equal the sum of the lines it showed the
 * customer.
 *
 * So: round HALF UP, once, per line item. The stored `amountPaise` on each PickupItem is
 * the rounded figure, and the wallet credit is the exact SUM of those stored figures.
 * The ledger therefore always reconciles against the items — by construction, not by
 * luck — and the customer is never told one number and paid another.
 *
 * Half-up (rather than banker's rounding) because it is what a person checking the
 * arithmetic by hand expects, and the sums here are small and numerous; the statistical
 * bias banker's rounding exists to correct is worth less than being explicable to a
 * customer who is querying a ₹0.01 discrepancy.
 */
export function calculateItemCashbackPaise(weightGrams: number, ratePerKgPaise: number): number {
  if (!Number.isInteger(weightGrams) || weightGrams < 0) {
    throw new RangeError(`weightGrams must be a non-negative integer, got ${weightGrams}`);
  }

  if (!Number.isInteger(ratePerKgPaise) || ratePerKgPaise < 0) {
    throw new RangeError(`ratePerKgPaise must be a non-negative integer, got ${ratePerKgPaise}`);
  }

  const exact = weightGrams * ratePerKgPaise;

  // Integer half-up: add half the divisor before the integer division. No float ever
  // touches this value, so there is no 0.1 + 0.2 problem to reason about.
  return Math.floor((exact + GRAMS_PER_KG / 2) / GRAMS_PER_KG);
}

export interface WeighedItem {
  paperType: PaperType;
  weightGrams: number;
  ratePerKgPaise: number;
}

export interface CashbackLine extends WeighedItem {
  amountPaise: number;
}

export interface CashbackBreakdown {
  lines: CashbackLine[];
  totalWeightGrams: number;
  /** The exact sum of the line amounts. This is what gets credited. Nothing is re-rounded. */
  totalPaise: number;
}

/**
 * Prices a whole pickup.
 *
 * The total is the SUM OF THE ROUNDED LINES, never a re-rounding of the exact total.
 * Those two differ, and if the ledger used one while the customer's receipt showed the
 * other, every reconciliation would be a paisa out and nobody would know which was right.
 */
export function calculateCashback(items: readonly WeighedItem[]): CashbackBreakdown {
  const seen = new Set<PaperType>();

  for (const item of items) {
    // Two NEWSPAPER lines in one pickup would be double-counted. The DB has a unique
    // index on (pickupId, paperType) too; this is the same rule, checked before the write
    // so the partner gets a sensible error rather than a constraint violation.
    if (seen.has(item.paperType)) {
      throw new RangeError(`Duplicate paper type in one pickup: ${item.paperType}`);
    }
    seen.add(item.paperType);
  }

  const lines = items.map((item) => ({
    ...item,
    amountPaise: calculateItemCashbackPaise(item.weightGrams, item.ratePerKgPaise),
  }));

  return {
    lines,
    totalWeightGrams: lines.reduce((sum, line) => sum + line.weightGrams, 0),
    totalPaise: lines.reduce((sum, line) => sum + line.amountPaise, 0),
  };
}

/** Paise -> a rupee string, for display only. Never for arithmetic. */
export function paiseToRupees(paise: bigint | number): string {
  const value = typeof paise === 'bigint' ? paise : BigInt(Math.trunc(paise));
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;

  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/** Grams -> a kilogram string, for display only. */
export function gramsToKg(grams: number): string {
  return (grams / GRAMS_PER_KG).toFixed(3);
}
