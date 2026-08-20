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
// at stale content. Entries do still expire, though — Storage's own
// signed-URL lifetime — since a long-lived app process (RN apps can sit
// backgrounded for a long time without being killed) would otherwise
// keep handing out a URL Storage has already stopped honoring, with no
// way to recover short of a restart.
const SIGNED_URL_TTL_MS = 3600 * 1000;
// A cached URL is treated as expired this long before Storage's actual
// cutoff, so a caller can't be handed one that expires moments after use.
const SIGNED_URL_SAFETY_MARGIN_MS = 60 * 1000;

interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

function readSignedUrlCache(path: string): string | null {
  const entry = signedUrlCache.get(path);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    signedUrlCache.delete(path);
    return null;
  }
  return entry.url;
}

function writeSignedUrlCache(path: string, url: string): void {
  signedUrlCache.set(path, {
    url,
    expiresAt: Date.now() + SIGNED_URL_TTL_MS - SIGNED_URL_SAFETY_MARGIN_MS,
  });
}

export async function getHeroImageUrl(path: string): Promise<string | null> {
  const cached = readSignedUrlCache(path);
  if (cached) return cached;

  const { data, error } = await supabase.storage.from('recipe-images').createSignedUrl(path, 3600);
  if (error) return null;

  writeSignedUrlCache(path, data.signedUrl);
  return data.signedUrl;
}

/**
 * Batched form of getHeroImageUrl — one createSignedUrls network round
 * trip for every requested path instead of one createSignedUrl call
 * each, so a screen with several entries can set all their thumbnail
 * URLs into state together instead of one at a time as each individual
 * call happens to resolve (ThisWeekScreen.tsx's original per-entry
 * forEach visibly trickled images in this way). Already-cached paths are
 * served straight from the cache and never included in the batch call.
 * Returns only the paths it could resolve — a path missing from the
 * result either failed or was never requested with anything to resolve.
 */
export async function getHeroImageUrls(paths: string[]): Promise<Record<string, string>> {
  const uniquePaths = [...new Set(paths)];
  const uncached = uniquePaths.filter((path) => !readSignedUrlCache(path));

  if (uncached.length > 0) {
    const { data } = await supabase.storage.from('recipe-images').createSignedUrls(uncached, 3600);
    data?.forEach((result) => {
      if (result.path && result.signedUrl) writeSignedUrlCache(result.path, result.signedUrl);
    });
  }

  const resolved: Record<string, string> = {};
  uniquePaths.forEach((path) => {
    const cached = readSignedUrlCache(path);
    if (cached) resolved[path] = cached;
  });
  return resolved;
}

/**
 * Synchronous cache-only read, no network call — lets a screen read
 * whatever's already resolved (e.g. warmed by src/thisWeek/prefetch.ts
 * during StartupScreen) as its React state's initial value, instead of
 * starting from nothing and populating asynchronously after mount.
 */
export function getCachedHeroImageUrl(path: string): string | null {
  return readSignedUrlCache(path);
}
