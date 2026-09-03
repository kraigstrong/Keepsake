import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  acceptInvitation as acceptInvitationApi,
  createHousehold as createHouseholdApi,
  createProfile,
  fetchHousehold,
  fetchProfile,
  type Household,
  type Profile,
} from './api';
import { classifyInvitationFailure, invitationFailureMessage } from './invitationOutcome';
import { logError } from '../observability';
import { withTimeout } from '../shared/withTimeout';
import { useSession } from '../session/SessionProvider';

/**
 * Why this is four outcomes and not `{ error }`: three of them must lead
 * somewhere different. `retryable` keeps the token and offers Retry;
 * `terminal` spends it and explains why; `joined-refresh-failed` means
 * the membership row exists and the invitee must never be sent back to
 * "Create a household". See src/household/invitationOutcome.ts.
 */
export type AcceptInvitationResult =
  | { outcome: 'joined' }
  | { outcome: 'joined-refresh-failed'; message: string }
  | { outcome: 'retryable'; message: string }
  | { outcome: 'terminal'; message: string };

interface HouseholdContextValue {
  profile: Profile | null;
  household: Household | null;
  isLoading: boolean;
  /**
   * The initial load failed, so profile/household say nothing about what
   * this user has. Kept distinct from "loaded, and they have none"
   * because the two route differently: a null household means onboarding,
   * which offers "Create a household" — irreversible under ADR-0004.
   * This is the only place that reasoning lives; callers just branch.
   */
  loadError: boolean;
  retryLoad: () => void;
  /**
   * Refetch profile and household. Exposed for callers that change
   * household-level state the server owns — seeding the starter recipes
   * sets `starter_recipes_seeded_at`, and every screen reading it needs
   * the new value, not the snapshot from load time.
   */
  refreshHousehold: () => Promise<void>;
  setDisplayName: (displayName: string) => Promise<{ error: string | null }>;
  createHousehold: () => Promise<{ error: string | null }>;
  acceptInvitation: (token: string) => Promise<AcceptInvitationResult>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

// The first fetch after sign-in can go out before supabase-js has the new
// access token on it: observed 2026-09-01, a GET /households 40ms after
// verifyOtp returned 200 came back 401, and a brand-new invitee got a
// full-screen error instead of her household. Retrying inside the shared
// load, not just the mount effect, also covers refresh(): a failure there
// after accept_invitation had already succeeded would clear the pending
// token and render "Create a household" to someone who just joined one.
const LOAD_RETRY_DELAYS_MS = [300, 900];

// supabase-js goes through fetch, which has no default timeout on React
// Native: a request that *stalls* rather than fails never settles, and
// every spinner waiting on one is permanent. These bound the two awaits
// on the invitation path — the accept itself, and the refresh it needs
// before the invitee can be shown their household. Both are safe to
// retry, which is what makes a timeout the right answer rather than an
// abort: accept_invitation re-entered by the same caller returns their
// household again, and the loads are reads.
const ACCEPT_TIMEOUT_MS = 10_000;
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Only meaningful once signed in — mounted unconditionally alongside
 * SessionProvider (not just when session !== null) so app/_layout.tsx
 * keeps a single Stack with three mutually exclusive Stack.Protected
 * branches (signed-out / onboarding / main app) rather than remounting
 * a whole separate navigator per auth state.
 */
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumped by retryLoad to re-run the load effect below.
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Tracks which userId profile/household/isLoading currently reflect.
  // When userId changes, force isLoading back to true in this same
  // render (React's "adjusting state during render" pattern) rather than
  // waiting for the effect below to run on the next pass. Without this,
  // there's one render — right when SessionProvider resolves from no
  // session to a real one — where userId has already changed but this
  // provider hasn't re-fetched yet, so it still reports isLoading=false
  // with the previous (no-user) household=null. AuthenticatedRouteBoundary
  // reads that as "fully loaded, no household" and flashes onboarding.
  const [loadedForUserId, setLoadedForUserId] = useState(userId);
  if (userId !== loadedForUserId) {
    setLoadedForUserId(userId);
    setIsLoading(true);
    setLoadError(false);
  }

  // No setState here — a pure fetch so both the mount/userId-change effect
  // below and the mutation handlers can share it. Kept out of the effect
  // itself because an async function's setState calls made before its
  // first await run synchronously, which react-hooks/set-state-in-effect
  // (correctly) treats as "not actually deferred."
  const loadHouseholdState = useCallback(async (): Promise<{
    profile: Profile | null;
    household: Household | null;
  }> => {
    if (!userId) return { profile: null, household: null };
    let lastError: unknown;
    for (let attempt = 0; attempt <= LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const [fetchedProfile, fetchedHousehold] = await Promise.all([
          fetchProfile(userId),
          fetchHousehold(),
        ]);
        return { profile: fetchedProfile, household: fetchedHousehold };
      } catch (error) {
        lastError = error;
        const retryDelay = LOAD_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) break;
        // Logged even though the retry may well succeed: the retry is a
        // UX fix, not a diagnosis, and swallowing the attempt that failed
        // would destroy the only evidence of why it did.
        logError(error, { context: 'householdLoadRetry', attempt });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    throw lastError;
  }, [userId]);

  // Bounds the whole retry chain, not each attempt: three stalled
  // attempts at ten seconds each would be half a minute of splash.
  const loadWithinTimeout = useCallback(
    () => withTimeout(loadHouseholdState(), LOAD_TIMEOUT_MS, 'household load'),
    [loadHouseholdState],
  );

  const refresh = useCallback(async () => {
    const { profile: fetchedProfile, household: fetchedHousehold } = await loadWithinTimeout();
    setProfile(fetchedProfile);
    setHousehold(fetchedHousehold);
    setIsLoading(false);
  }, [loadWithinTimeout]);

  useEffect(() => {
    let cancelled = false;
    loadWithinTimeout()
      .then(({ profile: fetchedProfile, household: fetchedHousehold }) => {
        if (cancelled) return;
        setProfile(fetchedProfile);
        setHousehold(fetchedHousehold);
        setLoadError(false);
        setIsLoading(false);
      })
      // Sets loadError, not just isLoading — see the field's own comment.
      .catch((error) => {
        if (cancelled) return;
        logError(error, { context: 'householdInitialLoad' });
        setLoadError(true);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadWithinTimeout, loadAttempt]);

  const retryLoad = useCallback(() => {
    setIsLoading(true);
    setLoadError(false);
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const setDisplayName = async (displayName: string): Promise<{ error: string | null }> => {
    if (!userId) return { error: 'not signed in' };
    try {
      await createProfile(userId, displayName);
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'failed to save display name' };
    }
  };

  const createHousehold = async (): Promise<{ error: string | null }> => {
    try {
      await createHouseholdApi();
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'failed to create household' };
    }
  };

  // The two awaits are deliberately not in one try. Collapsing them
  // reports a refresh failure as a failure to accept — which is what
  // happened on 2026-09-01: the membership row was written, the refetch
  // 401'd, and the invitee was shown "Create a household", the one
  // irreversible action in the app (ADR-0004). The caller has to be able
  // to tell "you are not in" from "you are in, we just can't show it".
  const acceptInvitation = async (token: string): Promise<AcceptInvitationResult> => {
    try {
      await withTimeout(acceptInvitationApi(token), ACCEPT_TIMEOUT_MS, 'accept_invitation');
    } catch (err) {
      logError(err, { context: 'acceptInvitation' });
      return {
        outcome: classifyInvitationFailure(err) === 'terminal' ? 'terminal' : 'retryable',
        message: invitationFailureMessage(err),
      };
    }

    try {
      await refresh();
    } catch (err) {
      logError(err, { context: 'acceptInvitationRefresh' });
      return {
        outcome: 'joined-refresh-failed',
        message: "You're in — we just couldn't load your household yet.",
      };
    }

    return { outcome: 'joined' };
  };

  return (
    <HouseholdContext.Provider
      value={{
        profile,
        household,
        isLoading,
        loadError,
        retryLoad,
        refreshHousehold: refresh,
        setDisplayName,
        createHousehold,
        acceptInvitation,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold(): HouseholdContextValue {
  const context = useContext(HouseholdContext);
  if (!context) {
    throw new Error('useHousehold must be used within a HouseholdProvider');
  }
  return context;
}
