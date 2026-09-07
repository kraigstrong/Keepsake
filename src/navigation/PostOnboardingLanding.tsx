import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import { logError } from '../observability';
import { fetchHasAnyRecipes } from '../recipes/api';
import { useSession } from '../session/SessionProvider';
import { withTimeout } from '../shared/withTimeout';

/**
 * Which tab a just-onboarded account opens on (#189).
 *
 * This Week is the tabs group's first screen, so it is where everyone
 * landed — including a brand-new account, for whom it is empty and
 * cannot usefully be filled, because there are no recipes to plan yet.
 * Library is the screen that has something to do: it carries the
 * starter-recipes offer.
 *
 * Three properties this has to hold, and each one shapes something here:
 *
 * 1. Decided *once, after onboarding* — not a stored tab preference.
 *    Someone who empties their library a month from now must not be
 *    re-routed, so nothing here runs on a cold launch of an
 *    already-onboarded account (app/_layout.tsx's `sawOnboarding` is
 *    what enforces that).
 * 2. The answer must exist *before* the tabs stack first renders. A
 *    `<Redirect>` only works on a route's first render — one appearing
 *    later is silently dropped (see app/invite/[token].tsx:53 and the
 *    incident behind it) — and redirecting after This Week has already
 *    painted would be a visible flash of the exact screen this is
 *    trying to avoid. So the route boundary holds StartupScreen up
 *    until `hasLandingDecision`.
 * 3. Failing to answer must not strand anyone on the splash. Every
 *    failure path falls through to This Week, which is just the
 *    behavior that shipped before this existed.
 *
 * Everything here is keyed by user id, not merely guarded by a "have we
 * done this yet" flag. Signing out and onboarding a second account does
 * not restart the process or unmount this provider, so a flag would let
 * the first account's answer stand for the second — and would let a
 * slow first request land on a second account that had already taken
 * over. Same reasoning, and the same fence, as src/thisWeek/prefetch.ts.
 */
interface PostOnboardingLandingContextValue {
  /**
   * False until the answer is in. The route boundary holds StartupScreen
   * up on this rather than on an "is deciding" flag, because the flag
   * would still be false on the first render after onboarding completes
   * — the effect that starts the decision has not run yet — and that one
   * ungated render is enough to mount the tabs and make the redirect
   * land too late to work.
   */
  hasLandingDecision: boolean;
  /**
   * True only between the decision landing and the tab consuming it —
   * false at every other moment, which is what makes this a one-shot
   * redirect rather than a standing rule.
   */
  shouldRedirectToLibrary: boolean;
  /** Idempotent across the provider's whole life; safe to call from a re-running effect. */
  decideLanding: () => void;
  consumeRedirect: () => void;
}

const PostOnboardingLandingContext = createContext<PostOnboardingLandingContextValue | null>(null);

// Bounds the one query the decision waits on. Deliberately short: this
// is splash time a brand-new user is already sitting through, and the
// fallback is not an error state, just the previous behavior.
const DECISION_TIMEOUT_MS = 2500;

export function PostOnboardingLandingProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  // Carries the user it was made for, so a decision belonging to a
  // previous account is not mistaken for this one's. That matters for
  // the boundary's splash gate specifically: reading a stale `true`
  // there would let the tabs mount before this account's answer exists.
  const [decision, setDecision] = useState<{ userId: string; redirect: boolean } | null>(null);
  // Which user a request has been started for. A ref, not state,
  // because decideLanding is called from an effect that would re-run on
  // any state this changed.
  const startedForUserId = useRef<string | null>(null);

  const decideLanding = useCallback(() => {
    if (!userId || startedForUserId.current === userId) return;
    startedForUserId.current = userId;
    const forUserId = userId;
    withTimeout(fetchHasAnyRecipes(), DECISION_TIMEOUT_MS, 'post-onboarding landing')
      .catch((error) => {
        // An invitee onboarding on a bad connection is the realistic
        // case. Logged because a decision made blind is worth knowing
        // about, but nothing is shown for it: the app just opens.
        logError(error, { context: 'postOnboardingLanding' });
        return true;
      })
      .then((hasRecipes) => {
        // A slower request for an account that has since been signed out
        // of must not answer for whoever signed in after it.
        if (startedForUserId.current !== forUserId) return;
        setDecision({ userId: forUserId, redirect: !hasRecipes });
      });
  }, [userId]);

  const hasLandingDecision = decision !== null && decision.userId === userId;
  const shouldRedirectToLibrary = hasLandingDecision && decision.redirect;

  // Spends the redirect while leaving the decision itself in place —
  // the boundary's gate reads that, and re-opening it would put the
  // splash back up.
  const consumeRedirect = useCallback(
    () => setDecision((current) => (current ? { ...current, redirect: false } : current)),
    [],
  );

  return (
    <PostOnboardingLandingContext.Provider
      value={{ hasLandingDecision, shouldRedirectToLibrary, decideLanding, consumeRedirect }}
    >
      {children}
    </PostOnboardingLandingContext.Provider>
  );
}

export function usePostOnboardingLanding(): PostOnboardingLandingContextValue {
  const context = useContext(PostOnboardingLandingContext);
  if (!context) {
    throw new Error('usePostOnboardingLanding must be used within a PostOnboardingLandingProvider');
  }
  return context;
}
