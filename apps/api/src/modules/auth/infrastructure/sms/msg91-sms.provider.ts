import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import { type SendSmsCommand, type SmsProvider } from '../../domain/ports/sms-provider.port';

/**
 * Sends OTP SMS via MSG91's Flow API.
 *
 * A "Flow" is MSG91's template mechanism: you register an OTP message with the DLT
 * authority once (TRAI requires this for any transactional SMS in India), MSG91 gives
 * that template a Flow id, and every send after that just fills in the variable — here,
 * `OTP`, which must match whatever variable name you used when building the Flow in the
 * MSG91 dashboard.
 *
 * NEVER log `command.body` — it carries the OTP in plaintext, and this is exactly the
 * class the console provider's doc comment warns must not exist twice.
 */
@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger(Msg91SmsProvider.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(command: SendSmsCommand): Promise<void> {
    const authKey = this.config.get('MSG91_AUTH_KEY', { infer: true });
    const sender = this.config.get('MSG91_SENDER_ID', { infer: true });
    const templateId =
      command.templateId ?? this.config.get('MSG91_DLT_TEMPLATE_ID', { infer: true });

    // The env schema's superRefine guarantees these are set whenever SMS_PROVIDER=msg91,
    // so reaching here without them means the app booted in a state the schema should
    // have refused — a bug, not a runtime condition to degrade gracefully from.
    if (authKey === undefined || sender === undefined || templateId === undefined) {
      throw new InternalServerErrorException('MSG91 is not configured.');
    }

    // India numbers only need the national number, not the +91 — MSG91's API expects it
    // without the leading plus.
    const mobile = command.to.replace(/^\+/, '');

    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: authKey },
      body: JSON.stringify({
        template_id: templateId,
        sender,
        recipients: [{ mobiles: mobile, OTP: command.body }],
      }),
    });

    if (!response.ok) {
      // The response body can echo request parameters back; do not log it, only the status.
      this.logger.error(`MSG91 send failed with status ${response.status}`);
      throw new InternalServerErrorException('Failed to send SMS.');
    }
  }
}
