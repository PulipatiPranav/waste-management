/**
 * Outbound SMS.
 *
 * The interface is deliberately narrow. Everything a real provider (MSG91, Twilio,
 * Gupshup) needs beyond this — API keys, sender IDs, DLT template registration,
 * delivery webhooks — is that adapter's problem, not the caller's. Swapping
 * providers must never require touching a use case.
 *
 * Implementations MUST NOT log the message body: it contains the OTP.
 */
export interface SendSmsCommand {
  /** E.164. */
  to: string;
  body: string;
  /**
   * Indian regulation (TRAI DLT) requires transactional SMS to be sent against a
   * pre-registered template id. Optional here so the console provider can ignore it;
   * a real provider will require it.
   */
  templateId?: string;
}

export interface SmsProvider {
  send(command: SendSmsCommand): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
