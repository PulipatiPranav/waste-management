import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';

import {
  type PushMessage,
  type PushOutcome,
  type PushTarget,
} from '../../domain/ports/notification-provider.port';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/**
 * Firebase Cloud Messaging (Android), over the HTTP v1 API.
 *
 * No `firebase-admin` SDK: it drags a large native-ish dependency in for one endpoint. Instead
 * this signs a service-account JWT (RS256) with node:crypto, exchanges it for a short-lived OAuth
 * access token (cached until just before expiry), and POSTs to `messages:send` over fetch — the
 * same "talk to the provider's REST API directly" approach as the Razorpay adapter.
 *
 * The only subtle part is error CLASSIFICATION, because the retry policy depends on it: a dead
 * token (`UNREGISTERED`, `INVALID_ARGUMENT`) is permanent and must be deactivated, while a quota
 * or availability error is transient and worth a retry. Getting this wrong means either retrying
 * garbage forever or throwing away a message a retry would have delivered.
 */
@Injectable()
export class FcmProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger(FcmProvider.name);
  private readonly account: ServiceAccount;
  private accessToken: { value: string; expiresAtMs: number } | null = null;

  constructor(serviceAccountJson: string) {
    this.account = JSON.parse(serviceAccountJson) as ServiceAccount;
    if (!this.account.client_email || !this.account.private_key || !this.account.project_id) {
      throw new Error('FCM service account JSON is missing client_email/private_key/project_id.');
    }
  }

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    try {
      const token = await this.oauthToken();
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: target.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
            },
          }),
        },
      );

      if (response.ok) {
        return { token: target.token, ok: true, permanent: false };
      }

      const bodyText = await response.text();
      const status = extractFcmStatus(bodyText);
      const permanent =
        status === 'UNREGISTERED' ||
        status === 'INVALID_ARGUMENT' ||
        status === 'NOT_FOUND' ||
        response.status === 404;

      return {
        token: target.token,
        ok: false,
        permanent,
        error: `FCM ${response.status}: ${status}`,
      };
    } catch (error) {
      // A thrown error (network, token exchange) is transient by nature — the message was never
      // seen by FCM, so a retry is exactly right.
      return {
        token: target.token,
        ok: false,
        permanent: false,
        error: error instanceof Error ? error.message : 'FCM request failed',
      };
    }
  }

  /** Returns a cached OAuth access token, refreshing it a minute before it expires. */
  private async oauthToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken !== null && this.accessToken.expiresAtMs > now + 60_000) {
      return this.accessToken.value;
    }

    const assertion = this.signJwt(now);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!response.ok) {
      throw new Error(`FCM OAuth token exchange failed: ${response.status}`);
    }

    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = {
      value: json.access_token,
      expiresAtMs: now + json.expires_in * 1000,
    };
    this.logger.debug('Refreshed FCM OAuth token.');
    return json.access_token;
  }

  private signJwt(nowMs: number): string {
    const iat = Math.floor(nowMs / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp: iat + 3600,
      }),
    );
    const signingInput = `${header}.${claims}`;
    const signature = createSign('RSA-SHA256')
      .update(signingInput)
      .sign(this.account.private_key, 'base64url');
    return `${signingInput}.${signature}`;
  }
}

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function extractFcmStatus(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { status?: string; details?: unknown[] } };
    return parsed.error?.status ?? 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}
