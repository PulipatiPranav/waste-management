import { sniffImage } from './image-signature';

describe('sniffImage', () => {
  it('recognises a JPEG by its magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(sniffImage(jpeg)).toBe('image/jpeg');
  });

  it('recognises a PNG by its magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffImage(png)).toBe('image/png');
  });

  it('rejects a payload that merely CLAIMS to be an image (spoofed Content-Type)', () => {
    // An HTML page an attacker labelled image/jpeg on the multipart part.
    const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
    expect(sniffImage(html)).toBeNull();
  });

  it('rejects a buffer too short to hold a signature', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('rejects bytes that are close-but-not-a-signature', () => {
    // First two JPEG bytes but a wrong third — must not pass.
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});
