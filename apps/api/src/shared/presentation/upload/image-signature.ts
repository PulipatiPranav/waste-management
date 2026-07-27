/**
 * Content-type sniffing by magic bytes.
 *
 * A multipart upload's `mimetype` is whatever the client wrote in the part's `Content-Type` header —
 * it is a claim, not a fact. An attacker can label an HTML page or a script `image/jpeg` and, on an
 * endpoint that trusts the header, get it stored and later served from our origin. So we verify the
 * FIRST BYTES of the actual payload against the format's signature and reject anything that does not
 * match, regardless of what the header said. (OWASP API8 / unrestricted upload.)
 */

/** The image formats the product accepts, keyed by the canonical mime we store them as. */
export type SniffedImage = 'image/jpeg' | 'image/png';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

/**
 * Returns the real image type of the bytes, or `null` if they are not a JPEG or PNG. The caller must
 * treat `null` as "reject", never fall back to the client's claimed type.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (startsWith(buffer, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(buffer, PNG_MAGIC)) return 'image/png';
  return null;
}
