/**
 * Photo-import MIME trust gap (threat-model.md T23, found by Codex
 * review on PR #54): `uploadOriginalPhoto` (src/photoImport/photoImport.ts)
 * declares its own `contentType` to Supabase Storage, and the
 * `recipe-images` bucket's MIME allowlist checks that caller-declared
 * header, not the actual bytes — a Supabase Storage platform limitation,
 * not something this app's policy can override. This function closes the
 * gap on the read side instead: `import-recipe/index.ts`'s photo path
 * sniffs the downloaded bytes' real magic-byte signature before handing
 * anything to the vision API, rather than trusting the upload's declared
 * type.
 *
 * Only the three formats the `recipe-images` bucket actually allows
 * (`allowed_mime_types`, recipe_images_storage.sql) are recognized —
 * anything else, including a well-formed image of a different format,
 * returns null and the caller fails the job before spending an Anthropic
 * call on it.
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
