import { Button, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../src/session/SessionProvider';

// Settings — reached via the header action in app/(tabs)/_layout.tsx, not
// a bottom tab (prd.md §24). "Few settings" per prd.md §2 — real content
// lands as later phases need actual settings to expose. Sign out is here
// early because the authenticated-route-boundary needs a real exercised
// path back to /sign-in, not just the entry direction.
export default function SettingsScreen() {
  const { signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text testID="settings-placeholder">Settings</Text>
      <Button title="Sign out" onPress={() => signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});
