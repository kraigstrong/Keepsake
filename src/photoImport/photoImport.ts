import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { randomId } from '../shared/randomId';
import { supabase } from '../supabase/instance';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

// Larger cap and higher quality than heroImage.ts's stripMetadataAndResize
// (1200px/0.85) — this copy exists to be viewed full-detail later
// (IMG-03: a recipe card or cookbook page needs to stay legible), not to
// be a lightweight thumbnail (ADR-0017 decision 1).
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.92;

/**
 * IMG-02/IMG-03: preserve the original image, viewable later — this
 * returns the picker's original asset URI untouched (no cropping/
 * compression applied here). Any downstream copy-into-permanent-storage
 * step is Phase 4's job once the recipe data model exists.
 *
 * Both capture and library-pick go through ImagePicker's system UI
 * (launchCameraAsync / launchImageLibraryAsync) rather than a custom
 * camera view — the PRD's "Camera" and "Existing photo" import sources
 * don't call for a custom viewfinder/overlay, so the simpler, Apple-
 * recommended system-UI path covers both without a second native
 * dependency (expo-camera, evaluated and dropped for this reason).
 */
export async function captureFromCamera(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchCameraAsync({ quality: 1 });
  return toPickedPhoto(result);
}

export async function pickExistingPhoto(): Promise<PickedPhoto | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  return toPickedPhoto(result);
}

function toPickedPhoto(result: ImagePicker.ImagePickerResult): PickedPhoto | null {
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * IMG-02/IMG-03 meets the metadata-stripping security checklist item
 * (ADR-0017 decision 1): re-saving as a fresh JPEG strips EXIF (GPS,
 * device info) as a side effect, same technique as heroImage.ts's
 * stripMetadataAndResize, just at a size/quality that stays legible as
 * a standalone reference photo rather than a thumbnail. "Preserve
 * original image" is read as preserving what the user captured, not
 * every byte the camera produced — recorded here, not left implicit.
 */
export async function preserveOriginalPhoto(uri: string): Promise<string> {
  const image = await ImageManipulator.manipulate(uri)
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION })
    .renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return result.uri;
}

/**
 * Upload-before-processing (ADR-0017 decision 2): the client uploads the
 * preserved original to Storage first and the Edge Function is handed a
 * path, not image bytes — keeps the request well under the Edge
 * Function's body-size ceiling, and means the original survives even if
 * extraction itself fails. Path convention: "<household_id>/originals/
 * <uuid>.jpg" — a new segment under the existing recipe-images bucket,
 * whose RLS policies already key off the household_id path prefix only
 * (proven by supabase/tests/database/photo_import_storage.test.sql).
 */
export async function uploadOriginalPhoto(householdId: string, localUri: string): Promise<string> {
  const path = `${householdId}/originals/${randomId()}.jpg`;
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
