import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConnectivityProvider, useConnectivity } from '../src/connectivity/ConnectivityProvider';
import { OfflineState } from '../src/components/OfflineState';
import { ToastProvider } from '../src/components/Toast';
import { DeepLinkProvider } from '../src/deepLinks/DeepLinkProvider';
import { HouseholdProvider, useHousehold } from '../src/household/HouseholdProvider';
import { drainAppGroupQueueIntoOutbox, submitPendingOutboxItems } from '../src/import/outboxEngine';
import { initObservability, logError } from '../src/observability';
import { SessionProvider, useSession } from '../src/session/SessionProvider';
import { useDevAutoSignIn } from '../src/session/useDevAutoSignIn';
import { syncHousehold } from '../src/sync/syncEngine';
import { colors, spacing } from '../src/theme/tokens';

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
      <ToastProvider>
        <SafeAreaProvider>
          <DeepLinkProvider>
            <SessionProvider>
              <HouseholdProvider>
                <ConnectivityAwareApp />
              </HouseholdProvider>
            </SessionProvider>
          </DeepLinkProvider>
        </SafeAreaProvider>
      </ToastProvider>
    </GestureHandlerRootView>
  );
}

// Wraps the whole app (not just the signed-in branch) so the offline
// banner is visible even on sign-in — connectivity matters there too
// (email OTP needs a connection). household is null until onboarding
// completes; sync is a no-op until then (ADR-0013 — Phase 6 is
// read-only offline support, nothing to sync before a household exists).
function ConnectivityAwareApp() {
  const { household } = useHousehold();
  const householdId = household?.id ?? null;

  return (
    <ConnectivityProvider
      onReconnect={() => {
        triggerHouseholdSync(householdId);
        triggerImportOutboxWork(householdId);
      }}
    >
      <HouseholdSyncOnMount householdId={householdId} />
      <ImportOutboxOnMount householdId={householdId} />
      <View style={{ flex: 1 }}>
        <OfflineBanner />
        <AuthenticatedRouteBoundary />
      </View>
    </ConnectivityProvider>
  );
}

function triggerHouseholdSync(householdId: string | null): void {
  if (!householdId) return;
  syncHousehold(householdId).catch((error) => logError(error, { context: 'householdSync' }));
}

// Initial sync once the household is known (cold launch, per
// execution-plan.md's Phase 6 validation) — separate from
// ConnectivityProvider's onReconnect, which only covers the
// offline -> online transition, not first mount.
function HouseholdSyncOnMount({ householdId }: { householdId: string | null }) {
  useEffect(() => {
    triggerHouseholdSync(householdId);
  }, [householdId]);
  return null;
}

// Draining the App Group queue is a pure local operation (no auth, no
// network) and always runs, even signed out or pre-onboarding — a share
// captured before the user signs in must still survive to be submitted
// later (ADR-0016 decision 1). Submission itself is gated on a
// household existing (create_import_job requires one server-side
// regardless); re-runs when householdId transitions from null to set so
// anything drained before onboarding finished gets submitted once it
// can be.
function triggerImportOutboxWork(householdId: string | null): void {
  drainAppGroupQueueIntoOutbox()
    .then(() => (householdId ? submitPendingOutboxItems() : undefined))
    .catch((error) => logError(error, { context: 'importOutbox' }));
}

function ImportOutboxOnMount({ householdId }: { householdId: string | null }) {
  useEffect(() => {
    triggerImportOutboxWork(householdId);
  }, [householdId]);
  return null;
}

function OfflineBanner() {
  const { isOnline } = useConnectivity();
  if (isOnline) return null;
  return (
    <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
      <OfflineState testID="global-offline-banner" />
    </View>
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
  useDevAutoSignIn();

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
        <Stack.Screen name="recipe" />
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
