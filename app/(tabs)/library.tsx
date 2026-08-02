import { StyleSheet, View } from 'react-native';

import { EmptyState } from '../../src/components/EmptyState';

// Library — recipe collection browsing (prd.md §14). No data model
// exists yet (Phase 4+), so this is the empty state; sorted rows land
// once there's something to show.
export default function LibraryScreen() {
  return (
    <View style={styles.container}>
      <EmptyState
        title="No recipes yet"
        message="Recipes you save will show up here."
        testID="library-placeholder"
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
