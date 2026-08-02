import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initObservability } from '../src/observability';
import { SessionProvider, useSession } from '../src/session/SessionProvider';

// Runs once, at module-evaluation time — before RootLayout's first
// render — because Sentry wants init() to run as early as possible so
// it can catch startup errors.
initObservability();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <AuthenticatedRouteBoundary />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Phase 2 builds the boundary/shape; Phase 3 supplies the real Supabase
// Auth session behind useSession() (ADR-0007). `isLoading` briefly gates
// nothing/blank rather than a real loading state — swapped for the shared
// loading component once that exists (later Phase 2 commit).
function AuthenticatedRouteBoundary() {
  const { session, isLoading } = useSession();

  if (isLoading) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={session !== null}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="settings"
          options={{ headerShown: true, title: 'Settings', presentation: 'modal' }}
        />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
