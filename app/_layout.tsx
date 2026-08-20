import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConnectivityProvider, useConnectivity } from '../src/connectivity/ConnectivityProvider';
import { ChevronLeftIcon } from '../src/components/icons/ChevronLeftIcon';
import { OfflineState } from '../src/components/OfflineState';
import { StartupScreen } from '../src/components/StartupScreen';
import { ToastProvider, useToast } from '../src/components/Toast';
import { submitPendingCookingEvents } from '../src/cooking/outboxEngine';
import { DeepLinkProvider } from '../src/deepLinks/DeepLinkProvider';
import { HouseholdProvider, useHousehold } from '../src/household/HouseholdProvider';
import { ImportActivityProvider, useImportActivity } from '../src/import/ImportActivityContext';
import {
  drainAppGroupQueueIntoOutbox,
  submitPendingOutboxItems,
  summarizeOutboxOutcomes,
} from '../src/import/outboxEngine';
import { initObservability, logError } from '../src/observability';
import { sweepOrphanedOriginalPhotos } from '../src/photoImport/orphanedPhotoSweep';
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
        <ImportActivityProvider>
          <SafeAreaProvider>
            <DeepLinkProvider>
              <SessionProvider>
                <HouseholdProvider>
                  <ConnectivityAwareApp />
                </HouseholdProvider>
              </SessionProvider>
            </DeepLinkProvider>
          </SafeAreaProvider>
        </ImportActivityProvider>
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
  const { showToast } = useToast();
  const { notifyImportCompleted } = useImportActivity();

  // ADR-0020 (Codex review, PR #33): always-fresh ref, not state — an
  // in-flight outbox drain reads this mid-loop to notice an account
  // switch that happened after the drain started, which a value closed
  // over at call time never could. Updated in an effect (never during
  // render, per this project's react-hooks/refs rule), so it always
  // reflects the most recently committed householdId by the time any
  // async callback reads it.
  const householdIdRef = useRef(householdId);
  useEffect(() => {
    householdIdRef.current = householdId;
  }, [householdId]);
  const getCurrentHouseholdId = useCallback(() => householdIdRef.current, []);

  return (
    <ConnectivityProvider
      onReconnect={() => {
        triggerHouseholdSync(householdId);
        triggerImportOutboxWork(
          householdId,
          getCurrentHouseholdId,
          showToast,
          notifyImportCompleted,
        );
        triggerCookingEventOutboxWork(householdId, getCurrentHouseholdId);
      }}
    >
      <HouseholdSyncOnMount householdId={householdId} />
      <ImportOutboxLifecycle
        householdId={householdId}
        getCurrentHouseholdId={getCurrentHouseholdId}
        showToast={showToast}
        notifyImportCompleted={notifyImportCompleted}
      />
      <CookingEventOutboxLifecycle
        householdId={householdId}
        getCurrentHouseholdId={getCurrentHouseholdId}
      />
      <OrphanedPhotoSweepLifecycle householdId={householdId} />
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

// Same trigger shape as triggerImportOutboxWork (mount + foreground +
// reconnect), simpler body: submitPendingCookingEvents returns void, not
// an outcome array — there's no toast to show (ADR-0024, see
// outboxEngine.ts's own header comment for why).
function triggerCookingEventOutboxWork(
  householdId: string | null,
  getCurrentHouseholdId: () => string | null,
): void {
  if (!householdId) return;
  submitPendingCookingEvents(householdId, getCurrentHouseholdId).catch((error) =>
    logError(error, { context: 'cookingEventOutbox' }),
  );
}

function CookingEventOutboxLifecycle({
  householdId,
  getCurrentHouseholdId,
}: {
  householdId: string | null;
  getCurrentHouseholdId: () => string | null;
}) {
  useEffect(() => {
    triggerCookingEventOutboxWork(householdId, getCurrentHouseholdId);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        triggerCookingEventOutboxWork(householdId, getCurrentHouseholdId);
      }
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCurrentHouseholdId is a stable identity across renders; only householdId should re-trigger this.
  }, [householdId]);
  return null;
}

// T15 (docs/threat-model.md): housekeeping only, no toast/state of its
// own — same mount + foreground trigger shape as the outbox lifecycles
// above, but no account-switch guard is needed here. Unlike the outbox
// loops (many individual submissions over an extended time), this is one
// household-scoped Storage list/query/remove sequence per call; if the
// signed-in household changes mid-flight, RLS itself (keyed off the
// caller's *current* session, not the householdId this closure captured)
// just stops matching the in-flight household's path prefix — the call
// degrades to a safe no-op, never a cross-household delete.
function triggerOrphanedPhotoSweep(householdId: string | null): void {
  if (!householdId) return;
  sweepOrphanedOriginalPhotos(householdId).catch((error) =>
    logError(error, { context: 'orphanedPhotoSweep' }),
  );
}

function OrphanedPhotoSweepLifecycle({ householdId }: { householdId: string | null }) {
  useEffect(() => {
    triggerOrphanedPhotoSweep(householdId);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        triggerOrphanedPhotoSweep(householdId);
      }
    });

    return () => subscription.remove();
  }, [householdId]);
  return null;
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
//
// A Share-Extension-originated import has no screen of its own to land
// on — unlike the in-app single-URL/bulk-paste flows, which navigate
// somewhere on completion, this runs entirely in the background. The
// toast is the only signal the user gets that "the thing I shared"
// resolved to anything at all; without it, a successful import is
// indistinguishable from one that silently vanished.
//
// notifyImportCompleted (found via live testing, 2026-08-14): the same
// "runs in the background, no screen of its own" problem means a
// screen already sitting focused (e.g. Library) when this resolves has
// no navigation event to trigger its own refresh either — the toast
// fires, but the new recipe stays missing until navigating away and
// back. Bumping this on any non-empty outcome gives an already-focused
// screen something to react to instead of relying on a future focus
// event that may never come.
function triggerImportOutboxWork(
  householdId: string | null,
  getCurrentHouseholdId: () => string | null,
  showToast: (message: string) => void,
  notifyImportCompleted: () => void,
): void {
  drainAppGroupQueueIntoOutbox(householdId)
    .then(() => (householdId ? submitPendingOutboxItems(householdId, getCurrentHouseholdId) : []))
    .then((outcomes) => {
      const message = summarizeOutboxOutcomes(outcomes);
      if (message) {
        showToast(message);
        notifyImportCompleted();
      }
    })
    .catch((error) => logError(error, { context: 'importOutbox' }));
}

// Cold launch alone isn't enough: the realistic path for a Share
// Extension capture is "share from Safari, then switch back to
// Keepsake" — a plain foreground, not a relaunch, since nothing about
// sharing quits the app. Without an AppState listener, that share sits
// captured but undrained until the app is eventually force-quit and
// reopened, which the user has no reason to ever do. Mirrors
// SessionProvider's own AppState('active')-driven pattern for the same
// "mobile backgrounding breaks timer-based assumptions" reason.
function ImportOutboxLifecycle({
  householdId,
  getCurrentHouseholdId,
  showToast,
  notifyImportCompleted,
}: {
  householdId: string | null;
  getCurrentHouseholdId: () => string | null;
  showToast: (message: string) => void;
  notifyImportCompleted: () => void;
}) {
  useEffect(() => {
    triggerImportOutboxWork(householdId, getCurrentHouseholdId, showToast, notifyImportCompleted);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        triggerImportOutboxWork(
          householdId,
          getCurrentHouseholdId,
          showToast,
          notifyImportCompleted,
        );
      }
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast/getCurrentHouseholdId/notifyImportCompleted are stable identities across renders; only householdId should re-trigger this.
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
// or fully set up. `isLoading` gates StartupScreen rather than routing
// anywhere yet.
function AuthenticatedRouteBoundary() {
  const router = useRouter();
  const { session, isLoading: sessionLoading } = useSession();
  const { profile, household, isLoading: householdLoading } = useHousehold();
  useDevAutoSignIn();

  if (sessionLoading) {
    return <StartupScreen />;
  }
  if (session !== null && householdLoading) {
    return <StartupScreen />;
  }

  const isOnboarded = session !== null && profile !== null && household !== null;
  const needsOnboarding = session !== null && !isOnboarded;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isOnboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recipe" />
        <Stack.Screen name="this-week" />
        <Stack.Screen name="groceries" />
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
        <Stack.Screen
          name="archived-recipes"
          options={{
            headerShown: true,
            title: 'Archived Recipes',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={10}
                testID="archived-recipes-back-button"
              >
                <ChevronLeftIcon color={colors.textPrimary} size={26} />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen
          name="recently-deleted"
          options={{
            headerShown: true,
            title: 'Recently Deleted',
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back"
                hitSlop={10}
                testID="recently-deleted-back-button"
              >
                <ChevronLeftIcon color={colors.textPrimary} size={26} />
              </Pressable>
            ),
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
