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
import { logError } from '../observability';
import { useSession } from '../session/SessionProvider';

interface HouseholdContextValue {
  profile: Profile | null;
  household: Household | null;
  isLoading: boolean;
  /**
   * The initial load failed, so profile/household say nothing about what
   * this user actually has. Distinct from "loaded, and they have none" on
   * purpose: collapsing the two routes a transient network failure into
   * onboarding, which offers "Create a household" — irreversible, since
   * ADR-0004 has no leave path.
   */
  loadError: boolean;
  retryLoad: () => void;
  setDisplayName: (displayName: string) => Promise<{ error: string | null }>;
  createHousehold: () => Promise<{ error: string | null }>;
  acceptInvitation: (token: string) => Promise<{ error: string | null }>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

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
    const [fetchedProfile, fetchedHousehold] = await Promise.all([
      fetchProfile(userId),
      fetchHousehold(),
    ]);
    return { profile: fetchedProfile, household: fetchedHousehold };
  }, [userId]);

  const refresh = useCallback(async () => {
    const { profile: fetchedProfile, household: fetchedHousehold } = await loadHouseholdState();
    setProfile(fetchedProfile);
    setHousehold(fetchedHousehold);
    setIsLoading(false);
  }, [loadHouseholdState]);

  useEffect(() => {
    let cancelled = false;
    loadHouseholdState()
      .then(({ profile: fetchedProfile, household: fetchedHousehold }) => {
        if (cancelled) return;
        setProfile(fetchedProfile);
        setHousehold(fetchedHousehold);
        setLoadError(false);
        setIsLoading(false);
      })
      // Without this the app hung on StartupScreen forever, silently, on
      // any transient failure here — no error, no retry, nothing logged
      // (developer cold launch, 2026-08-30). Deliberately sets loadError
      // rather than just clearing isLoading: falling through with a null
      // household reads as "new user" and routes to onboarding's
      // "Create a household" button.
      .catch((error) => {
        if (cancelled) return;
        logError(error, { context: 'householdInitialLoad' });
        setLoadError(true);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadHouseholdState, loadAttempt]);

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

  const acceptInvitation = async (token: string): Promise<{ error: string | null }> => {
    try {
      await acceptInvitationApi(token);
      await refresh();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'failed to accept invitation' };
    }
  };

  return (
    <HouseholdContext.Provider
      value={{
        profile,
        household,
        isLoading,
        loadError,
        retryLoad,
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
