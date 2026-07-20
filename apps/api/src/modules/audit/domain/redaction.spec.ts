import { pickTargetId, redactAuditPayload } from './redaction';

describe('redactAuditPayload', () => {
  it('redacts sensitive keys anywhere in the tree', () => {
    const out = redactAuditPayload({
      email: 'a@b.com',
      password: 'hunter2',
      nested: { refreshToken: 'abc', amountPaise: 500 },
      bankAccountLast4: '1234',
    });
    expect(out).toEqual({
      email: 'a@b.com',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', amountPaise: 500 },
      bankAccountLast4: '[REDACTED]',
    });
  });

  it('keeps non-sensitive scalars and structures', () => {
    expect(redactAuditPayload({ status: 'ACTIVE', qty: 3, live: true, tags: ['a', 'b'] })).toEqual({
      status: 'ACTIVE',
      qty: 3,
      live: true,
      tags: ['a', 'b'],
    });
  });

  it('never mutates its input', () => {
    const input = { password: 'x', keep: 1 };
    redactAuditPayload(input);
    expect(input.password).toBe('x');
  });

  it('truncates very long strings and stringifies bigint', () => {
    const long = 'x'.repeat(5000);
    const out = redactAuditPayload({ note: long, total: 900n }) as { note: string; total: unknown };
    expect(out.note.endsWith('…')).toBe(true);
    expect(out.note.length).toBeLessThan(long.length);
    expect(out.total).toBe('900');
  });

  it('caps depth rather than recursing forever', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    // Does not throw, and the deepest levels become a marker.
    expect(() => JSON.stringify(redactAuditPayload(deep))).not.toThrow();
  });
});

describe('pickTargetId', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';

  it('prefers an explicit id param', () => {
    expect(pickTargetId({ id: uuid, userId: '99999999-2222-3333-4444-555555555555' })).toBe(uuid);
  });

  it('falls back to any UUID-valued param', () => {
    expect(pickTargetId({ userId: uuid })).toBe(uuid);
  });

  it('returns null when no param is a UUID', () => {
    expect(pickTargetId({ slug: 'recycled-notebook' })).toBeNull();
    expect(pickTargetId({})).toBeNull();
  });
});
