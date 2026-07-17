import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification. Pure, so the single most security-critical check in the
 * payment path — "did this webhook really come from the gateway, or from anyone on the
 * internet who found the URL?" — can be tested exhaustively without a gateway or a network.
 *
 * The scheme is Razorpay's, which is also the industry-standard one: HMAC-SHA256 over the
 * EXACT raw request body, keyed with the webhook secret, hex-encoded, compared to the
 * signature header. Two details are load-bearing:
 *
 *  - The RAW body, byte for byte. A re-serialised parsed JSON has different whitespace and
 *    key order, so its HMAC differs from the sender's and every valid webhook would be
 *    rejected. The controller must therefore read `req.rawBody`, not the parsed object.
 *
 *  - A CONSTANT-TIME comparison. `===` on the hex strings leaks, through timing, how many
 *    leading characters matched, which is enough to forge a signature byte by byte. A naive
 *    equality check here is a textbook vulnerability, not a style nit.
 */
export function computeHmacSha256Hex(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  signature: string;
  secret: string;
}): boolean {
  if (input.signature.length === 0 || input.secret.length === 0) {
    return false;
  }

  const expected = computeHmacSha256Hex(input.rawBody, input.secret);

  // Both are fixed-length hex of the same hash, so a length mismatch means the provided
  // signature is simply malformed — bail before timingSafeEqual, which throws on unequal
  // lengths. (Comparing lengths is not itself a leak: the expected length is public.)
  if (expected.length !== input.signature.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(input.signature, 'utf8'));
}
