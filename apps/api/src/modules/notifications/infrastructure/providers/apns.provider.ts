import { Injectable, Logger } from '@nestjs/common';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createSign } from 'node:crypto';

import {
  type PushMessage,
  type PushOutcome,
  type PushTarget,
} from '../../domain/ports/notification-provider.port';

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** The .p8 EC private key contents (PEM). */
  privateKey: string;
  /** Production APNs by default; a caller can point at the sandbox host. */
  host?: string;
}

/**
 * Apple Push Notification service (iOS), over HTTP/2 with token-based (JWT ES256) auth.
 *
 * APNs is HTTP/2-only, so this holds a long-lived session rather than a fetch per send. The
 * provider JWT is ES256 over {teamId, keyId} and is reused for up to an hour (Apple's window),
 * refreshed lazily. Error classification mirrors FCM's: `Unregistered` (410) and `BadDeviceToken`
 * are permanent (deactivate the token), while `TooManyRequests`, `InternalServerError` and
 * `ServiceUnavailable` are transient (retry).
 */
@Injectable()
export class ApnsProvider {
  readonly name = 'apns';
  private readonly logger = new Logger(ApnsProvider.name);
  private readonly host: string;
  private session: ClientHttp2Session | null = null;
  private jwt: { value: string; issuedAtMs: number } | null = null;

  constructor(private readonly config: ApnsConfig) {
    this.host = config.host ?? 'https://api.push.apple.com';
  }

  send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    return new Promise((resolve) => {
      try {
        const session = this.ensureSession();
        const payload = JSON.stringify({
          aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
          ...message.data,
        });

        const request = session.request({
          [constants.HTTP2_HEADER_METHOD]: 'POST',
          [constants.HTTP2_HEADER_PATH]: `/3/device/${target.token}`,
          authorization: `bearer ${this.providerJwt()}`,
          'apns-topic': this.config.bundleId,
          'apns-push-type': 'alert',
          'content-type': 'application/json',
        });

        let status = 0;
        let body = '';
        request.on('response', (headers) => {
          status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
        });
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => (body += chunk));
        request.on('end', () => {
          if (status === 200) {
            resolve({ token: target.token, ok: true, permanent: false });
            return;
          }
          const reason = extractApnsReason(body);
          const permanent =
            status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic';
          resolve({
            token: target.token,
            ok: false,
            permanent,
            error: `APNs ${status}: ${reason}`,
          });
        });
        request.on('error', (error: Error) => {
          resolve({ token: target.token, ok: false, permanent: false, error: error.message });
        });
        request.end(payload);
      } catch (error) {
        resolve({
          token: target.token,
          ok: false,
          permanent: false,
          error: error instanceof Error ? error.message : 'APNs request failed',
        });
      }
    });
  }

  private ensureSession(): ClientHttp2Session {
    if (this.session === null || this.session.closed || this.session.destroyed) {
      this.session = connect(this.host);
      this.session.on('error', (error: Error) =>
        this.logger.error(`APNs session error: ${error.message}`),
      );
    }
    return this.session;
  }

  private providerJwt(): string {
    const now = Date.now();
    // Apple accepts a token for up to 60 minutes; refresh well inside that.
    if (this.jwt !== null && now - this.jwt.issuedAtMs < 50 * 60_000) {
      return this.jwt.value;
    }
    const iat = Math.floor(now / 1000);
    const header = base64Url(JSON.stringify({ alg: 'ES256', kid: this.config.keyId }));
    const claims = base64Url(JSON.stringify({ iss: this.config.teamId, iat }));
    const signingInput = `${header}.${claims}`;
    // ieee-p1363 gives the raw r||s signature APNs (JOSE) expects, not DER.
    const signature = createSign('SHA256')
      .update(signingInput)
      .sign({ key: this.config.privateKey, dsaEncoding: 'ieee-p1363' }, 'base64url');
    this.jwt = { value: `${signingInput}.${signature}`, issuedAtMs: now };
    return this.jwt.value;
  }
}

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function extractApnsReason(body: string): string {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? 'Unknown';
  } catch {
    return 'Unknown';
  }
}
