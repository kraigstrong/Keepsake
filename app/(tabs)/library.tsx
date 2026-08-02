import { StyleSheet, Text, View } from 'react-native';

// Library — recipe collection browsing (prd.md §14). Empty-state UI lands
// once the shared primitives exist; this is route-shell scaffolding only.
export default function LibraryScreen() {
  return (
    <View style={styles.container}>
      <Text testID="library-placeholder">Library</Text>
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
