import * as ImagePicker from 'expo-image-picker';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

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
