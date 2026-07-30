import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { Msg91SmsProvider } from './msg91-sms.provider';

function fakeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values: Partial<Env> = {
    MSG91_AUTH_KEY: 'auth-key-123',
    MSG91_SENDER_ID: 'ANVAYA',
    MSG91_DLT_TEMPLATE_ID: 'template-456',
    ...overrides,
  };
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('Msg91SmsProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends the OTP via the MSG91 Flow API with the configured sender and template', async () => {
    const fetchMock: jest.Mock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    const provider = new Msg91SmsProvider(fakeConfig());
    await provider.send({ to: '+919876543210', body: '482913' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toBe('https://control.msg91.com/api/v5/flow/');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers).toMatchObject({ authkey: 'auth-key-123' });

    const body: unknown = JSON.parse(call[1].body as string);
    expect(body).toMatchObject({
      template_id: 'template-456',
      sender: 'ANVAYA',
      // The leading + is stripped — MSG91 expects the bare national number.
      recipients: [{ mobiles: '919876543210', OTP: '482913' }],
    });
  });

  it('never logs the OTP itself — only the send is asserted, not console output', async () => {
    // A behavioural guard: send() must not throw or route the body anywhere but the
    // request payload above. This test exists to keep a future refactor honest.
    const fetchMock: jest.Mock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await new Msg91SmsProvider(fakeConfig()).send({ to: '+919876543210', body: 'SECRET-OTP' });

    for (const call of logSpy.mock.calls) {
      expect(call.join(' ')).not.toContain('SECRET-OTP');
    }
  });

  it('throws when MSG91 responds with a non-2xx status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(
      new Msg91SmsProvider(fakeConfig()).send({ to: '+919876543210', body: '482913' }),
    ).rejects.toThrow('Failed to send SMS.');
  });

  it('throws if constructed without required config (should never happen past the env schema)', async () => {
    const provider = new Msg91SmsProvider(fakeConfig({ MSG91_AUTH_KEY: undefined }));
    await expect(provider.send({ to: '+919876543210', body: '482913' })).rejects.toThrow(
      'MSG91 is not configured.',
    );
  });
});
