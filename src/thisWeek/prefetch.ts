import { Image } from 'react-native';

import { fetchCurrentWeeklyPlan, type ThisWeekPlan } from './api';
import { getHeroImageUrls } from '../recipes/heroImage';

/**
 * One-shot, in-memory only — not a cache layer (ADR-0021: This Week
 * stays always-online with no local mirror; every focus after the first
 * still calls fetchCurrentWeeklyPlan() itself, exactly as before this
 * existed). Exists so AuthenticatedRouteBoundary (app/_layout.tsx) can
 * kick off This Week's network fetch — plan and hero images both — as
 * soon as a session resolves, running concurrently with
 * HouseholdProvider's own fetch while StartupScreen is still showing,
 * and can wait (boundedly — see waitForThisWeekPrefetch) for it to
 * actually finish before dismissing the splash, so ThisWeekScreen's
 * first paint is already fully populated instead of visibly loading a
 * second time right after. Keyed by userId, and further fenced by a
 * per-request token (below), so a real sign-out/sign-in in quick
 * succession (e.g. a shared dev/test device) can't have an earlier,
 * slower request's late completion overwrite a later one's already-
 * correct result.
 *
 * Fired before household is confirmed to exist (deliberately — that's
 * what makes it early enough to matter), so a first-time user's
 * onboarding -> This Week transition can consume a prefetch that was
 * started before their household existed and therefore failed. That
 * used to be recorded here as an accepted, self-correcting rough edge;
 * it reached a real device on 2026-08-29 and was neither. See
 * loadThisWeekPlan below for what actually makes it self-correcting.
 */
let prefetchedForUserId: string | null = null;
let prefetchedPlanPromise: Promise<ThisWeekPlan> | null = null;
let prefetchedPlanResult: ThisWeekPlan | null = null;
// Settles once the plan AND every entry's hero image have been resolved
// (or failed) — what waitForThisWeekPrefetch races against a timeout.
let prefetchedReadyPromise: Promise<void> | null = null;
// Bumped on every new prefetchThisWeek call and captured per-request, so
// a request's async continuations can tell whether they're still the
// current one before writing to the shared state above. Without this, a
// slower earlier request (e.g. account A's) resolving after a later one
// (account B's) already started would overwrite prefetchedPlanResult
// with A's plan while prefetchedForUserId still correctly reads "B" —
// peekPrefetchedThisWeekPlan('B') would then hand B account A's recipe
// titles and cache-warmed photos. Real risk on a shared device (a real
// sign-out/sign-in in quick succession), not just the dev/test scenario
// the userId keying alone was written to guard against.
let requestToken = 0;

export function prefetchThisWeek(userId: string): void {
  if (prefetchedForUserId === userId && prefetchedPlanPromise) return;
  const token = ++requestToken;
  prefetchedForUserId = userId;
  prefetchedPlanResult = null;
  prefetchedPlanPromise = fetchCurrentWeeklyPlan();
  // Swallowed here — a failed prefetch shouldn't surface on its own;
  // loadThisWeekPlan below still surfaces it to whatever consumes it,
  // same as a normal fetchCurrentWeeklyPlan() rejection would.
  prefetchedPlanPromise
    .then((plan) => {
      if (token === requestToken) prefetchedPlanResult = plan;
    })
    .catch(() => {});

  prefetchedReadyPromise = prefetchedPlanPromise
    .then(async (plan) => {
      const paths = plan.entries
        .map((entry) => entry.heroImagePath)
        .filter((path): path is string => path !== null);
      if (paths.length === 0) return;

      // Resolving the signed URL only gets the string ready — the actual
      // photo bytes are a separate network fetch RN's <Image> makes on
      // its own the first time a given uri renders, which is what was
      // still visibly trickling in one at a time even after the URLs
      // themselves resolved together. Image.prefetch() downloads into
      // RN's native image cache ahead of time, keyed by the exact same
      // uri string ThisWeekScreen's <Image source={{uri}}> will use, so
      // that later render is a cache hit instead of a fresh download.
      const urlsByPath = await getHeroImageUrls(paths).catch(() => ({}) as Record<string, string>);
      await Promise.all(
        Object.values(urlsByPath).map((url) => Image.prefetch(url).catch(() => false)),
      );
    })
    .catch(() => {});
}

function consumePrefetchedThisWeek(userId: string): Promise<ThisWeekPlan> | null {
  if (prefetchedForUserId !== userId) return null;
  const result = prefetchedPlanPromise;
  prefetchedPlanPromise = null;
  prefetchedPlanResult = null;
  prefetchedReadyPromise = null;
  prefetchedForUserId = null;
  return result;
}

/**
 * What ThisWeekScreen's load() actually calls on every load.
 *
 * A rejected prefetch falls through to a real fetch rather than being
 * surfaced. This is what makes the "self-correcting" claim above
 * actually true: the prefetch fires before the household is confirmed
 * to exist, so a first-time user's very first load consumed a rejection
 * caused by a household that existed by the time they got here. The
 * screen then showed a full-screen error on the first thing a new user
 * ever sees, and recovered only when they tapped Try again — self-
 * correcting in the sense that a manual retry worked, which is not what
 * that phrase should mean (developer device testing, 2026-08-29).
 *
 * A failed prefetch carries no information worth surfacing: it is an
 * optimization that didn't pay off, not a diagnosis of the network. If
 * the real fetch fails too, that error surfaces exactly as before.
 */
export function loadThisWeekPlan(userId: string | null): Promise<ThisWeekPlan> {
  const pending = userId ? consumePrefetchedThisWeek(userId) : null;
  if (!pending) return fetchCurrentWeeklyPlan();
  return pending.catch(() => fetchCurrentWeeklyPlan());
}

/**
 * Synchronous, cache-only read (no network, doesn't consume) — lets
 * ThisWeekScreen seed its plan state directly from an already-resolved
 * prefetch as its very first render, instead of starting from null and
 * populating asynchronously after mount. Returns null if nothing has
 * resolved yet (or nothing was ever prefetched for this userId); the
 * normal load() flow still runs regardless and is what actually keeps
 * the screen correct.
 */
export function peekPrefetchedThisWeekPlan(userId: string | null): ThisWeekPlan | null {
  if (!userId || prefetchedForUserId !== userId) return null;
  return prefetchedPlanResult;
}

/**
 * Waits (up to timeoutMs) for the prefetch to fully settle — plan and
 * every hero image — so AuthenticatedRouteBoundary can hold StartupScreen
 * up until This Week is actually ready to render complete, rather than
 * dismissing purely on session/household state and letting This Week do
 * its own visible load right after. Bounded so a slow or failed prefetch
 * can't leave the splash up indefinitely; resolves immediately if there's
 * nothing to wait for (never prefetched, or already for a different
 * userId).
 */
export function waitForThisWeekPrefetch(userId: string, timeoutMs: number): Promise<void> {
  if (prefetchedForUserId !== userId || !prefetchedReadyPromise) return Promise.resolve();
  const readyPromise = prefetchedReadyPromise;
  return new Promise<void>((resolve) => {
    // Cleared once the ready promise wins the race, rather than a bare
    // Promise.race, so the timer doesn't linger for the rest of
    // timeoutMs after this already resolved — harmless in the app
    // (nothing awaits it), but it's what Jest correctly flagged as an
    // open handle in tests otherwise.
    const timer = setTimeout(resolve, timeoutMs);
    readyPromise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
