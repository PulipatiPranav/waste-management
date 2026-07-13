import { parsePhoneNumberWithError, type CountryCode } from 'libphonenumber-js';

import { InvalidPhoneNumberError } from '../errors/auth.errors';

/**
 * A phone number, normalised to E.164.
 *
 * Normalisation is a correctness requirement, not a nicety. The phone number is the
 * account's identity here (`users.phone` is unique, there is no password for a
 * customer), so if `9876543210`, `+91 98765 43210` and `098765-43210` are stored as
 * three different strings, one human ends up with three accounts, three wallets and
 * three cashback balances. Every entry point must construct this type rather than
 * pass a raw string around.
 */
export class PhoneNumber {
  private constructor(readonly e164: string) {}

  /** @throws {InvalidPhoneNumberError} */
  static create(raw: string, defaultCountry: CountryCode = 'IN'): PhoneNumber {
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      throw new InvalidPhoneNumberError('Phone number is required');
    }

    try {
      const parsed = parsePhoneNumberWithError(trimmed, defaultCountry);

      if (!parsed.isValid()) {
        throw new InvalidPhoneNumberError('Phone number is not valid');
      }

      return new PhoneNumber(parsed.number);
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) throw error;
      throw new InvalidPhoneNumberError('Phone number could not be parsed');
    }
  }

  /**
   * `+919876543210` -> `+91******3210`.
   *
   * The only representation allowed in a log line or an error message. A phone
   * number is personal data under the DPDP Act, and support tickets, crash reports
   * and log aggregators all leak.
   */
  get masked(): string {
    const tail = this.e164.slice(-4);
    const head = this.e164.slice(0, 3);
    return `${head}${'*'.repeat(Math.max(0, this.e164.length - 7))}${tail}`;
  }

  equals(other: PhoneNumber): boolean {
    return this.e164 === other.e164;
  }

  toString(): string {
    return this.e164;
  }
}
