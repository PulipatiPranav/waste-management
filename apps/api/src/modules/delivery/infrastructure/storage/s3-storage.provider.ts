import {
  DeleteObjectCommand as S3DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand as S3PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { type Env } from '@/config/env.schema';
import {
  type PutObjectCommand,
  type StorageProvider,
} from '../../domain/ports/storage-provider.port';

/**
 * Production storage: any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean
 * Spaces, MinIO). Cloudflare R2 is the default recommendation in the setup guide — no
 * egress fees, and it speaks the same API as S3, which is why one client class covers
 * all of them.
 *
 * `forcePathStyle: true` matters for R2 and most non-AWS S3-compatible services: they
 * expect `https://<endpoint>/<bucket>/<key>`, not AWS's `https://<bucket>.<endpoint>/<key>`
 * virtual-hosted style. Leaving it off against R2 produces a DNS lookup failure, not a
 * clean error, so it is set unconditionally rather than left to guesswork.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    const endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    const bucket = this.config.get('S3_BUCKET', { infer: true });
    const accessKeyId = this.config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = this.config.get('S3_SECRET_ACCESS_KEY', { infer: true });

    // Guaranteed by the env schema's superRefine whenever STORAGE_PROVIDER=s3; reaching
    // here without them is a bug, not a condition to degrade gracefully from.
    if (
      endpoint === undefined ||
      bucket === undefined ||
      accessKeyId === undefined ||
      secretAccessKey === undefined
    ) {
      throw new Error('S3 storage is not configured.');
    }

    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region: this.config.get('S3_REGION', { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async put(command: PutObjectCommand): Promise<void> {
    try {
      await this.client.send(
        new S3PutObjectCommand({
          Bucket: this.bucket,
          Key: command.key,
          Body: command.body,
          ContentType: command.contentType,
        }),
      );
    } catch {
      // Never leak bucket/endpoint details or SDK internals to a caller.
      throw new InternalServerErrorException('Failed to store the file.');
    }
  }

  /**
   * A real, cryptographically pre-signed S3 URL — the object is otherwise private, and
   * this is the only way to read it, for exactly the window requested. Same contract as
   * LocalStorageProvider.getSignedUrl: a proof-of-delivery photo shows the inside of a
   * customer's doorway, so the URL must expire.
   */
  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new S3DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      throw new InternalServerErrorException('Failed to delete the file.');
    }
  }
}
