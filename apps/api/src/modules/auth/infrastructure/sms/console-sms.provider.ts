import { Injectable, Logger } from '@nestjs/common';

import { type SendSmsCommand, type SmsProvider } from '../../domain/ports/sms-provider.port';

/**
 * Development SMS provider: prints the message instead of sending it.
 *
 * This is the ONE place in the codebase permitted to write an OTP in plaintext, and
 * it exists so a developer can actually log in locally. The env schema refuses to
 * boot with `NODE_ENV=production` and `SMS_PROVIDER=console`, so it cannot reach
 * production, where this behaviour would mean every OTP is written into the log
 * aggregator and no user ever receives one.
 *
 * A real provider (MSG91, Twilio, Gupshup) is a new class implementing SmsProvider
 * and one extra line in the enum + factory. No use case changes.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  send(command: SendSmsCommand): Promise<void> {
    this.logger.warn(
      `\n` +
        `┌─────────────────────────────────────────────────────────┐\n` +
        `│ DEV SMS — not actually sent                             │\n` +
        `├─────────────────────────────────────────────────────────┤\n` +
        `│ to:   ${command.to.padEnd(48)}│\n` +
        `│ body: ${command.body.slice(0, 48).padEnd(48)}│\n` +
        `└─────────────────────────────────────────────────────────┘`,
    );

    return Promise.resolve();
  }
}
