import { Button, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../src/session/SessionProvider';

// Real sign-in (Supabase Auth) is Phase 3's job (ADR-0007) — this proves
// the authenticated-route-boundary mechanism with a stub session.
export default function SignInScreen() {
  const { signIn } = useSession();

  return (
    <View style={styles.container}>
      <Text testID="sign-in-placeholder">Sign in</Text>
      <Button title="Sign in (stub)" onPress={() => signIn({ userId: 'dev-stub-user' })} />
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
