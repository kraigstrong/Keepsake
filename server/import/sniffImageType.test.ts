import { sniffImageType } from './sniffImageType';

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function withPadding(signature: number[], paddingLength = 20): Uint8Array {
  return bytes([...signature, ...new Array(paddingLength).fill(0)]);
}

describe('sniffImageType', () => {
  it('recognizes a real JPEG signature', () => {
    expect(sniffImageType(withPadding([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('recognizes a real PNG signature', () => {
    expect(sniffImageType(withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
  });

  it('recognizes a real WEBP signature', () => {
    const riff = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
    const size = [0x00, 0x00, 0x00, 0x00]; // container size, not validated
    const webp = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    expect(sniffImageType(bytes([...riff, ...size, ...webp, 0x00, 0x00]))).toBe('image/webp');
  });

  it('rejects a RIFF container that is not WEBP (e.g. a WAV file)', () => {
    const riff = [0x52, 0x49, 0x46, 0x46];
    const size = [0x00, 0x00, 0x00, 0x00];
    const wave = [0x57, 0x41, 0x56, 0x45]; // "WAVE"
    expect(sniffImageType(bytes([...riff, ...size, ...wave]))).toBeNull();
  });

  it('rejects arbitrary non-image bytes declared as image/jpeg (the T23 attack)', () => {
    const fakeBytes = bytes(Array.from('not actually an image').map((c) => c.charCodeAt(0)));
    expect(sniffImageType(fakeBytes)).toBeNull();
  });

  it('rejects an empty buffer', () => {
    expect(sniffImageType(bytes([]))).toBeNull();
  });

  it('rejects a buffer too short to contain any known signature', () => {
    expect(sniffImageType(bytes([0xff, 0xd8]))).toBeNull();
  });

  it('rejects a PDF (common non-image upload)', () => {
    const pdfHeader = Array.from('%PDF-1.4').map((c) => c.charCodeAt(0));
    expect(sniffImageType(withPadding(pdfHeader))).toBeNull();
  });
});
