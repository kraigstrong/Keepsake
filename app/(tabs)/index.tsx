import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../src/components/EmptyState';
import { colors, spacing, typography } from '../../src/theme/tokens';

// This Week — the default screen (prd.md §15). No data model exists yet
// (Phase 4+), so this is the empty state; cards/drag-to-reorder land once
// there's something to show.
export default function ThisWeekScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>This Week</Text>
      <View style={styles.content}>
        <EmptyState
          title="Nothing planned yet"
          message="Add a recipe to start planning this week's meals."
          testID="this-week-placeholder"
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
