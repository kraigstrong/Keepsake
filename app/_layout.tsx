import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeepLinkProvider } from '../src/deepLinks/DeepLinkProvider';
import { HouseholdProvider, useHousehold } from '../src/household/HouseholdProvider';
import { initObservability } from '../src/observability';
import { SessionProvider, useSession } from '../src/session/SessionProvider';
import { colors } from '../src/theme/tokens';

// Runs once, at module-evaluation time — before RootLayout's first
// render — because Sentry wants init() to run as early as possible so
// it can catch startup errors.
initObservability();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Ink & Paper's paper background is light — dark status bar icons
          (ADR-0009). Revisit once Cooking Mode's dark variant exists and
          needs to flip this per-screen. */}
      <StatusBar style="dark" />
      <SafeAreaProvider>
        <DeepLinkProvider>
          <SessionProvider>
            <HouseholdProvider>
              <AuthenticatedRouteBoundary />
            </HouseholdProvider>
          </SessionProvider>
        </DeepLinkProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Three mutually exclusive branches on one Stack (ADR-0007/ADR-0008):
// signed out, signed in but missing a profile/household (onboarding),
// or fully set up. `isLoading` briefly gates nothing/blank rather than
// a real loading state — swapped for the shared loading component once
// that exists (later Phase 2 commit).
function AuthenticatedRouteBoundary() {
  const { session, isLoading: sessionLoading } = useSession();
  const { profile, household, isLoading: householdLoading } = useHousehold();

  if (sessionLoading) {
    return null;
  }
  if (session !== null && householdLoading) {
    return null;
  }

  const isOnboarded = session !== null && profile !== null && household !== null;
  const needsOnboarding = session !== null && !isOnboarded;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isOnboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="settings"
          options={{
            headerShown: true,
            title: 'Settings',
            presentation: 'modal',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={session === null}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
