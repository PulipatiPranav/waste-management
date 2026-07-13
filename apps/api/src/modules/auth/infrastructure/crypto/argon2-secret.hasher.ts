import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';

import { type SecretHasher } from '../../domain/ports/hasher.port';

/**
 * Argon2id — mandated by the brief over bcrypt, and the right call: bcrypt is
 * memory-cheap, so a GPU/ASIC farm parallelises it far more effectively.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet's Argon2id recommendation
 * (19 MiB memory, 2 iterations, parallelism 1), rounded up on memory. Argon2's
 * resistance comes from memory cost; lowering `memoryCost` to make login feel snappy
 * is the one knob that quietly destroys the whole point.
 */
@Injectable()
export class Argon2SecretHasher implements SecretHasher {
  private readonly logger = new Logger(Argon2SecretHasher.name);

  private static readonly OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 4,
  };

  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, Argon2SecretHasher.OPTIONS);
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch (error) {
      // argon2.verify THROWS on a malformed hash string rather than returning false.
      // Letting that escape would turn a corrupt row into a 500, and — worse — the
      // timing-equalisation trick in StaffLoginUseCase deliberately verifies against
      // a dummy hash, which must fail quietly rather than blow up the request.
      this.logger.warn(
        `Argon2 verification could not be performed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }
}
