import { StyleSheet, View } from 'react-native';

import { colors, radii } from '../theme/tokens';

export interface ImagePlaceholderProps {
  size?: number;
  testID?: string;
}

// Shown before a recipe has an image (or while one is loading) — recipe
// images are stored locally, never hotlinked (prd.md §10), so this is
// purely a "nothing here yet" placeholder, not a network-loading state.
export function ImagePlaceholder({ size = 64, testID }: ImagePlaceholderProps) {
  return (
    <View
      style={[styles.container, { width: size, height: size }]}
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
