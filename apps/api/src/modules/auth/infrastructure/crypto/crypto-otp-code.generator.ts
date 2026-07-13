import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';

import { type OtpCodeGenerator } from '../../domain/ports/otp-code-generator.port';

@Injectable()
export class CryptoOtpCodeGenerator implements OtpCodeGenerator {
  /**
   * `crypto.randomInt`, never `Math.random()`.
   *
   * `Math.random()` is a seeded PRNG (xorshift128+ in V8): it is not merely "less
   * random", it is *predictable* — observing a handful of outputs lets an attacker
   * recover the internal state and compute the next OTP without ever seeing it. For a
   * value that is the sole credential guarding a user's wallet, that is fatal.
   *
   * `randomInt` also avoids modulo bias, which a naive `randomBytes % 10` would not.
   */
  generate(length: number): string {
    let code = '';

    for (let i = 0; i < length; i += 1) {
      code += randomInt(0, 10).toString();
    }

    return code;
  }
}
