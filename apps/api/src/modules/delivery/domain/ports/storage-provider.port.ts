/**
 * Object storage.
 *
 * An interface, not the AWS SDK, because the SDK must not appear inside a use case.
 * Concretely: swapping S3 for MinIO (local), DigitalOcean Spaces or Cloudflare R2 —
 * all S3-compatible — must be a change to one adapter and one line of module wiring,
 * not a grep-and-replace through the delivery service.
 *
 * Keep this narrow. Bucket names, credentials, region, multipart thresholds and
 * retry policy are the adapter's business.
 */
export interface PutObjectCommand {
  /** The object key, e.g. `delivery-proof/2026-07-14/<stopId>.jpg`. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageProvider {
  put(command: PutObjectCommand): Promise<void>;

  /**
   * A time-limited URL to read the object.
   *
   * Signed, and short-lived, because delivery photos show the inside of customers'
   * doorways. A permanently-public URL is a permanently-public photo of where somebody
   * lives — and object keys are guessable enough that "nobody will find it" is not a
   * security model.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;

  delete(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
