import { type IncomingMessage, type ServerResponse } from 'node:http';

import { CORRELATION_ID_HEADER } from '@/shared/presentation/middleware/correlation-id.middleware';
import { buildPinoHttpOptions, REDACT_PATHS } from './logger.config';

type ReqLike = IncomingMessage & { correlationId?: string };

function fakeReq(overrides: Partial<ReqLike> = {}): ReqLike {
  return { headers: {}, url: '/api/v1/wallet', ...overrides } as ReqLike;
}

function fakeRes(headersSent = false): { res: ServerResponse; setHeader: jest.Mock } {
  const setHeader = jest.fn();
  const res = { headersSent, setHeader } as unknown as ServerResponse;
  return { res, setHeader };
}

function genReqId(opts = buildPinoHttpOptions('info')) {
  // In pino-http the option is a function; narrow it for the test.
  return opts.genReqId as (req: IncomingMessage, res: ServerResponse) => string;
}

describe('buildPinoHttpOptions', () => {
  it('sets the level and a redaction policy for secret-bearing fields', () => {
    const opts = buildPinoHttpOptions('debug');
    expect(opts.level).toBe('debug');
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('*.otp');
    expect(REDACT_PATHS).toContain('*.token');
    // The redact policy is actually attached (not just the constant).
    expect(opts.redact).toMatchObject({ paths: REDACT_PATHS, censor: '[redacted]' });
  });

  describe('genReqId (the correlation id)', () => {
    it('reuses an id already on the request (idempotent with the middleware)', () => {
      const req = fakeReq({ correlationId: 'already-set' });
      const { res, setHeader } = fakeRes();
      expect(genReqId()(req, res)).toBe('already-set');
      expect(req.correlationId).toBe('already-set');
      expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, 'already-set');
    });

    it('reuses the incoming x-correlation-id header (mobile app supplied it)', () => {
      const req = fakeReq({ headers: { [CORRELATION_ID_HEADER]: 'from-mobile' } });
      const { res } = fakeRes();
      expect(genReqId()(req, res)).toBe('from-mobile');
      expect(req.correlationId).toBe('from-mobile');
    });

    it('mints a fresh id when the request carries none, and stamps it on the response', () => {
      const req = fakeReq();
      const { res, setHeader } = fakeRes();
      const id = genReqId()(req, res);
      expect(id).toMatch(/[0-9a-f-]{16,}/i);
      expect(req.correlationId).toBe(id);
      expect(setHeader).toHaveBeenCalledWith(CORRELATION_ID_HEADER, id);
    });

    it('does not set a header once the response has already started', () => {
      const req = fakeReq();
      const { res, setHeader } = fakeRes(true);
      const id = genReqId()(req, res);
      expect(id).toBeTruthy();
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
