import { StyleSheet, View, type DimensionValue } from 'react-native';

import { colors, radii } from '../theme/tokens';

export interface ImagePlaceholderProps {
  size?: number;
  // Overrides size for one axis or both — for a non-square footprint
  // (e.g. a full-width hero banner) rather than the square default most
  // callers (a photo-picker button) actually want.
  width?: DimensionValue;
  height?: DimensionValue;
  testID?: string;
}

// Shown before a recipe has an image (or while one is loading) — recipe
// images are stored locally, never hotlinked (prd.md §10), so this is
// purely a "nothing here yet" placeholder, not a network-loading state.
export function ImagePlaceholder({ size = 64, width, height, testID }: ImagePlaceholderProps) {
  return (
    <View
      style={[styles.container, { width: width ?? size, height: height ?? size }]}
      testID={testID}
      accessibilityLabel="No photo"
      accessible
    />
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
