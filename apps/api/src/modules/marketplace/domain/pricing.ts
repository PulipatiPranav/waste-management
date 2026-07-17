import { InvariantViolationError } from '@/shared/domain/errors/domain.error';

/**
 * The money arithmetic of a marketplace order. Pure integer paise, no floats — the same
 * discipline as the cashback ledger, for the same reason: prices get multiplied by
 * quantities and summed across lines, and integers make that exact and associative.
 *
 * There is no rounding anywhere in this file, and that is deliberate. A variant price is a
 * whole number of paise and a quantity is a whole number of units, so a line total is a
 * whole number of paise by construction. The moment a discount or a tax introduces a
 * fraction, it must be rounded ONCE, here, the way money.ts rounds cashback — but this
 * phase has neither, so introducing a rounding rule now would be inventing a decision
 * nobody has to make yet.
 */

export interface OrderLineInput {
  /** INTEGER PAISE, the price snapshotted at checkout. */
  unitPricePaise: number;
  /** Whole units. */
  quantity: number;
}

export interface PricedLine extends OrderLineInput {
  lineTotalPaise: number;
}

export interface OrderTotals {
  lines: PricedLine[];
  subtotalPaise: number;
  totalPaise: number;
}

function assertNonNegInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvariantViolationError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/** Prices one line: total = unit × quantity. Quantity must be strictly positive. */
export function priceLine(line: OrderLineInput): PricedLine {
  assertNonNegInt(line.unitPricePaise, 'unitPricePaise');
  if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
    throw new InvariantViolationError(`quantity must be a positive integer, got ${line.quantity}`);
  }
  return { ...line, lineTotalPaise: line.unitPricePaise * line.quantity };
}

/**
 * Totals an order. subtotal == total in this phase (no shipping or tax), but they are
 * distinct fields so that adding either later is an honest change rather than a
 * reinterpretation of what `total` always silently meant.
 */
export function calculateOrderTotals(lines: readonly OrderLineInput[]): OrderTotals {
  if (lines.length === 0) {
    throw new InvariantViolationError('An order must have at least one line.');
  }

  const priced = lines.map(priceLine);
  const subtotalPaise = priced.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  return { lines: priced, subtotalPaise, totalPaise: subtotalPaise };
}

export interface PaymentSplit {
  /** How much of the total the wallet covers. */
  walletPaise: number;
  /** The remainder, for the payment gateway. walletPaise + gatewayPaise === totalPaise. */
  gatewayPaise: number;
}

/**
 * Decides how an order total is split between the wallet and the gateway.
 *
 * The customer asks to apply up to `requestedWalletPaise` of wallet money. What they
 * actually get applied is bounded by two things they do not control: their real balance,
 * and the order total (you cannot pay ₹600 of wallet against a ₹500 order). So:
 *
 *   walletPaise  = min(requestedWallet, walletBalance, orderTotal)
 *   gatewayPaise = orderTotal − walletPaise
 *
 * The returned split ALWAYS sums to the total — that is the identity the atomic
 * confirmation flow and the DB `orders_split_sums_to_total` constraint both depend on. A
 * gatewayPaise of 0 means a fully-wallet-paid order, which confirms synchronously with no
 * gateway leg at all; a walletPaise of 0 means a pure-gateway order.
 *
 * This is pure and total: it never touches the wallet. The ACTUAL debit happens later,
 * under a row lock, inside confirmation — and can still fail there if the balance moved,
 * which is exactly why the wallet leg is part of the atomic flow and not trusted here.
 */
export function splitPayment(input: {
  totalPaise: number;
  walletBalancePaise: number;
  requestedWalletPaise: number;
}): PaymentSplit {
  assertNonNegInt(input.totalPaise, 'totalPaise');
  assertNonNegInt(input.walletBalancePaise, 'walletBalancePaise');
  assertNonNegInt(input.requestedWalletPaise, 'requestedWalletPaise');

  const walletPaise = Math.min(
    input.requestedWalletPaise,
    input.walletBalancePaise,
    input.totalPaise,
  );

  return { walletPaise, gatewayPaise: input.totalPaise - walletPaise };
}

/** Rupees for display only. Never stored, never used in arithmetic. */
export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
