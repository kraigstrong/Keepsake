import { StyleSheet, View } from 'react-native';

import { EmptyState } from '../../src/components/EmptyState';

// This Week — the default screen (prd.md §15). No data model exists yet
// (Phase 4+), so this is the empty state; cards/drag-to-reorder land once
// there's something to show.
export default function ThisWeekScreen() {
  return (
    <View style={styles.container}>
      <EmptyState
        title="Nothing planned yet"
        message="Add a recipe to start planning this week's meals."
        testID="this-week-placeholder"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
