/**
 * Detects a real image/jpeg|png|webp signature from raw bytes — see
 * threat-model.md's T23 for why (a caller-declared Content-Type can't be
 * trusted). Only the three formats the `recipe-images` bucket allows are
 * recognized; anything else, including a well-formed image of a
 * different format, returns null.
 */
export type SniffedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  // RIFF <4-byte size> WEBP — the size field is skipped, not validated;
  // it describes the container's own length claim, not the image
  // format, so it's not part of what this function is answering.
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  return riff === 'RIFF' && webp === 'WEBP';
}

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}
