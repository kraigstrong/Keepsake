import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { getHeroImageUrl } from './heroImage';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { colors } from '../theme/tokens';

export interface OriginalPhotoScreenProps {
  photoPath: string;
}

/**
 * IMG-03 (Phase 10, ADR-0017): the original photo a recipe was imported
 * from stays viewable later, unaffected by replacing or removing the
 * hero image (Phase 4's existing flow — original_photo_path and
 * hero_image_path are independent columns). getHeroImageUrl is reused
 * as-is despite the name: it's just "sign a path in the recipe-images
 * bucket," nothing hero-image-specific about it.
 */
export function OriginalPhotoScreen({ photoPath }: OriginalPhotoScreenProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getHeroImageUrl(photoPath).then((url) => {
      if (cancelled) return;
      if (url) setImageUrl(url);
      else setLoadError(true);
    });

    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't load the original photo"
        message="Check your connection and try again."
        testID="original-photo-load-error"
      />
    );
  }

  if (!imageUrl) {
    return <LoadingState label="Loading photo…" testID="original-photo-loading" />;
  }

  return (
    <View style={styles.container} testID="original-photo-screen">
      <Image
        source={{ uri: imageUrl }}
        style={styles.image}
        resizeMode="contain"
        testID="original-photo-image"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  image: {
    flex: 1,
  },
});
