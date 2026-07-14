import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { type Env } from '@/config/env.schema';
import {
  type PutObjectCommand,
  type StorageProvider,
} from '../../domain/ports/storage-provider.port';

/**
 * Development storage: writes objects to a local directory.
 *
 * Exists so the delivery flow can be run end to end without an S3 account or a MinIO
 * container. It is NOT production storage — there is no replication, no lifecycle
 * policy, and the files vanish with the pod. The env schema refuses to boot with
 * `NODE_ENV=production` and `STORAGE_PROVIDER=local` for exactly that reason.
 *
 * A real S3Provider is a new class implementing StorageProvider plus one line in the
 * module. No use case changes.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly signingKey: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.root = resolve(this.config.get('STORAGE_LOCAL_DIR', { infer: true }));
    this.signingKey = this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  async put(command: PutObjectCommand): Promise<void> {
    const path = this.pathFor(command.key);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, command.body);

    this.logger.debug(`Stored ${command.body.length} bytes at ${command.key}`);
  }

  /**
   * Mimics a pre-signed URL: the key plus an expiry, HMAC'd.
   *
   * Faithful enough that the client code which consumes it (and the mobile app in
   * Phase 13) does not have to change when this is swapped for real S3 — the URL is
   * opaque and time-limited either way.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac('sha256', this.signingKey)
      .update(`${key}:${expiresAt}`)
      .digest('hex');

    const base = this.config.get('PUBLIC_BASE_URL', { infer: true });
    const params = new URLSearchParams({ key, expires: String(expiresAt), signature });

    return Promise.resolve(`${base}/api/v1/delivery/proof?${params.toString()}`);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /**
   * Resolves a key to a path INSIDE the storage root, and refuses anything else.
   *
   * Path traversal is the whole risk here: a key of `../../etc/passwd` (or, more
   * plausibly, one built from a filename a delivery partner's phone supplied) would
   * otherwise write outside the storage directory. Keys are generated server-side
   * today, so this is defence in depth — but it is one line, and the day someone
   * derives a key from user input it is the only thing standing there.
   */
  private pathFor(key: string): string {
    const path = resolve(join(this.root, normalize(key)));

    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`);
    }

    return path;
  }
}
