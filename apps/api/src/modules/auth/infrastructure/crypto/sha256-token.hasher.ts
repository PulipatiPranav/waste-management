import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { type TokenHasher } from '../../domain/ports/hasher.port';

/**
 * SHA-256 for refresh tokens.
 *
 * Deliberately NOT Argon2. The input is 256 bits of CSPRNG output, so there is no
 * dictionary and no low-entropy structure to attack — a slow hash defends against
 * nothing here while adding ~100ms to every refresh, on every device, forever.
 *
 * Hashing at all is what matters: a stolen database dump must not hand the attacker
 * a pile of live, usable refresh tokens.
 */
@Injectable()
export class Sha256TokenHasher implements TokenHasher {
  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
