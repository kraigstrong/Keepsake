import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { randomId } from '../shared/randomId';
import { supabase } from '../supabase/instance';

export interface PickedHeroImage {
  uri: string;
  width: number;
  height: number;
}

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.85;

/**
 * Square crop via the native OS crop UI (IMG-04) — deliberately
 * separate from src/photoImport/photoImport.ts's pickExistingPhoto(),
 * which preserves the original, uncropped image for Phase 10's
 * photo-import flow (IMG-02/IMG-03 require the original stay viewable).
 * A recipe's hero image has no such requirement.
 */
export async function pickHeroImage(): Promise<PickedHeroImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    aspect: [1, 1],
  });

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Caps the image's dimensions and re-saves it as a fresh JPEG — this
 * strips EXIF metadata (location, device info) as a side effect of the
 * re-encode, per Phase 4's security checklist. Deliberately an explicit
 * step rather than relying on the picker's own crop output already
 * being metadata-free, since that would be leaning on an OS
 * implementation detail rather than something this code guarantees.
 */
export async function stripMetadataAndResize(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION })
    .renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}

/**
 * Uploads to the recipe-images bucket (Phase 3, ADR-0008) under its
 * established "<household_id>/..." path convention, keyed by a random
 * id rather than the recipe's own id — a hero image can be picked
 * before a brand-new recipe has been saved (and so has no id yet), and
 * hero_image_path is just wherever the file lives, not required to
 * structurally match the recipe it belongs to.
 */
export async function uploadHeroImage(householdId: string, localUri: string): Promise<string> {
  const path = `${householdId}/${randomId()}.jpg`;
  // Raw bytes, not a Blob: @supabase/storage-js only honors the
  // `contentType` option for non-Blob bodies — a Blob upload silently
  // uses the Blob's own `.type` instead, which React Native's
  // `fetch(uri).blob()` gets wrong for local files (observed as
  // "text/plain", rejected by the bucket's allowed_mime_types).
  const bytes = await new File(localUri).arrayBuffer();

  const { error } = await supabase.storage
    .from('recipe-images')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

  if (error) throw error;
  return path;
}

/**
 * The recipe-images bucket is private (Phase 3, ADR-0008) — a plain
 * public URL won't load, so display needs a short-lived signed URL
 * instead. Returns null on failure rather than throwing, so callers can
 * fall back to a placeholder instead of failing the whole screen over
 * a missing/stale image.
 */
// createSignedUrl mints a brand-new URL string on every call, even for
// the same object — without caching, a screen that re-resolves the same
// path twice in quick succession (e.g. ThisWeekScreen.tsx's load(),
// which can genuinely run more than once as a nested tab screen's focus
// settles) hands its <Image> a changed `uri` for an unchanged photo,
// which visibly re-fetches/redecodes. Safe to cache by path for the
// session: a hero image's path is a fresh random id per upload (see
// uploadHeroImage above), never reused, so a cached URL can't ever point
// at stale content.
const signedUrlCache = new Map<string, string>();

export async function getHeroImageUrl(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path);
  if (cached) return cached;

  const { data, error } = await supabase.storage.from('recipe-images').createSignedUrl(path, 3600);
  if (error) return null;

  signedUrlCache.set(path, data.signedUrl);
  return data.signedUrl;
}
