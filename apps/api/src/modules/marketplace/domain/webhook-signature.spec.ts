import { createHmac } from 'node:crypto';
import { computeHmacSha256Hex, verifyWebhookSignature } from './webhook-signature';

const SECRET = 'whsec_test_abc123';
const BODY = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_123"}}}}';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyWebhookSignature', () => {
  it('accepts a signature computed with the right secret over the exact body', () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign(BODY, SECRET), secret: SECRET }),
    ).toBe(true);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signature: sign(BODY, 'not-the-secret'),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects when the body was tampered with after signing — even one byte', () => {
    const signature = sign(BODY, SECRET);
    const tampered = BODY.replace('pay_123', 'pay_124');
    expect(verifyWebhookSignature({ rawBody: tampered, signature, secret: SECRET })).toBe(false);
  });

  it('rejects an empty or malformed signature', () => {
    expect(verifyWebhookSignature({ rawBody: BODY, signature: '', secret: SECRET })).toBe(false);
    expect(verifyWebhookSignature({ rawBody: BODY, signature: 'abcd', secret: SECRET })).toBe(
      false,
    );
  });

  it('rejects when no secret is configured', () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign(BODY, SECRET), secret: '' }),
    ).toBe(false);
  });

  it('computeHmacSha256Hex matches node crypto', () => {
    expect(computeHmacSha256Hex(BODY, SECRET)).toBe(sign(BODY, SECRET));
  });
});
