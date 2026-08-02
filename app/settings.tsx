import { StyleSheet, Text, View } from 'react-native';

import { Button } from '../src/components/Button';
import { useSession } from '../src/session/SessionProvider';
import { spacing, typography } from '../src/theme/tokens';

// Settings — reached via the header action in app/(tabs)/_layout.tsx, not
// a bottom tab (prd.md §24). "Few settings" per prd.md §2 — real content
// lands as later phases need actual settings to expose. Sign out is here
// early because the authenticated-route-boundary needs a real exercised
// path back to /sign-in, not just the entry direction.
export default function SettingsScreen() {
  const { signOut } = useSession();

  return (
    <View style={styles.container} testID="settings-placeholder">
      <Text style={styles.title}>Settings</Text>
      <Button title="Sign out" onPress={() => signOut()} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
  },
});
