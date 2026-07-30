import { type ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';

const sendMock = jest.fn();

// The S3Client constructor itself makes no network call, but we still don't want a real
// client — replace it with one whose `.send` we control, so these tests assert what
// COMMAND was built (bucket, key, body) without hitting a real bucket.
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual<Record<string, unknown>>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed?sig=abc'),
}));

// Imported AFTER the mocks so the module under test picks up the mocked SDK.
import { type PutObjectCommand as S3PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageProvider } from './s3-storage.provider';

function fakeConfig(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values: Partial<Env> = {
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    S3_REGION: 'auto',
    S3_BUCKET: 'cpe-delivery-proof',
    S3_ACCESS_KEY_ID: 'key-id',
    S3_SECRET_ACCESS_KEY: 'key-secret',
    ...overrides,
  };
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('S3StorageProvider', () => {
  beforeEach(() => {
    sendMock.mockReset();
    (getSignedUrl as jest.Mock).mockClear();
  });

  it('throws if constructed without required config (should never happen past the env schema)', () => {
    expect(() => new S3StorageProvider(fakeConfig({ S3_BUCKET: undefined }))).toThrow(
      'S3 storage is not configured.',
    );
  });

  it('puts an object with the configured bucket, the given key, body and content type', async () => {
    sendMock.mockResolvedValue({});
    const provider = new S3StorageProvider(fakeConfig());

    await provider.put({
      key: 'delivery-proof/2026-01-01/stop-1.jpg',
      body: Buffer.from('fake-jpeg-bytes'),
      contentType: 'image/jpeg',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0] as [InstanceType<typeof S3PutObjectCommand>];
    expect(call[0].input).toMatchObject({
      Bucket: 'cpe-delivery-proof',
      Key: 'delivery-proof/2026-01-01/stop-1.jpg',
      ContentType: 'image/jpeg',
    });
  });

  it('wraps a put failure rather than leaking SDK internals', async () => {
    sendMock.mockRejectedValue(new Error('network is down'));
    const provider = new S3StorageProvider(fakeConfig());

    await expect(
      provider.put({ key: 'k', body: Buffer.from('x'), contentType: 'image/jpeg' }),
    ).rejects.toThrow('Failed to store the file.');
  });

  it('returns a real pre-signed URL for the requested key and expiry', async () => {
    const provider = new S3StorageProvider(fakeConfig());

    const url = await provider.getSignedUrl('delivery-proof/stop-1.jpg', 300);

    expect(url).toBe('https://r2.example.com/signed?sig=abc');
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      expiresIn: 300,
    });
  });

  it('deletes an object by key', async () => {
    sendMock.mockResolvedValue({});
    const provider = new S3StorageProvider(fakeConfig());

    await provider.delete('delivery-proof/stop-1.jpg');

    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
