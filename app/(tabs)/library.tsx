import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../src/components/EmptyState';
import { colors, spacing, typography } from '../../src/theme/tokens';

// Library — recipe collection browsing (prd.md §14). No data model
// exists yet (Phase 4+), so this is the empty state; sorted rows land
// once there's something to show.
export default function LibraryScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Library</Text>
      <View style={styles.content}>
        <EmptyState
          title="No recipes yet"
          message="Recipes you save will show up here."
          testID="library-placeholder"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
