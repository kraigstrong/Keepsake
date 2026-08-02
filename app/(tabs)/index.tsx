import { StyleSheet, Text, View } from 'react-native';

// This Week — the default screen (prd.md §15). Empty-state UI and the
// global add action land once the shared primitives exist (later Phase 2
// commits); this is route-shell scaffolding only.
export default function ThisWeekScreen() {
  return (
    <View style={styles.container}>
      <Text testID="this-week-placeholder">This Week</Text>
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
