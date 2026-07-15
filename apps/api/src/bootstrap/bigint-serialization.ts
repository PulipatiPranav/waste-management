/**
 * Teach `JSON.stringify` how to serialise a BigInt.
 *
 * Without this, ANY BigInt that reaches a response body throws
 * `TypeError: Do not know how to serialize a BigInt` — and Express turns that into a 500.
 *
 * That matters because Prisma returns `BigInt` for every money column in this system
 * (wallet balances, ledger amounts). Every DTO converts them to strings deliberately, but
 * that is a convention held up by discipline: the first handler that returns a Prisma row
 * directly, or spreads one into a response, produces a 500 on the wallet endpoint — in
 * production, at runtime, with a passing type-check and a passing test suite that happens
 * never to hit that path.
 *
 * So: BigInt serialises as a STRING, not a number. A JSON number cannot hold a BigInt
 * (it loses precision past 2^53, i.e. around ₹90 trillion), and silently truncating a
 * financial value is far worse than a slightly awkward type on the wire. This is the same
 * choice the DTOs already make, so the API stays consistent either way.
 */
export function installBigIntSerialization(): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function toJSON(this: bigint): string {
    return this.toString();
  };
}
