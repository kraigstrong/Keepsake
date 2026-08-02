import { StyleSheet, Text, View } from 'react-native';

// Settings — reached via the header action in app/(tabs)/_layout.tsx, not
// a bottom tab (prd.md §24). "Few settings" per prd.md §2 — real content
// lands as later phases need actual settings to expose.
export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text testID="settings-placeholder">Settings</Text>
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
