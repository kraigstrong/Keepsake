import { fetchCurrentWeeklyPlan, type ThisWeekPlan } from './api';

/**
 * One-shot, in-memory only — not a cache layer (ADR-0021: This Week
 * stays always-online with no local mirror; every focus after the first
 * still calls fetchCurrentWeeklyPlan() itself, exactly as before this
 * existed). Exists so AuthenticatedRouteBoundary (app/_layout.tsx) can
 * kick off This Week's network fetch as soon as a session resolves —
 * running concurrently with HouseholdProvider's own fetch, while
 * StartupScreen is still showing — instead of ThisWeekScreen only
 * starting it after routing there. Keyed by userId so a real
 * sign-out/sign-in (e.g. a shared dev/test device) can't serve one
 * account's prefetch to another.
 *
 * Fired before household is confirmed to exist (deliberately — that's
 * what makes it early enough to matter), so a first-time user's
 * onboarding -> This Week transition can occasionally consume a
 * prefetch that was started before their household existed and
 * therefore failed. Accepted, self-correcting rough edge: ThisWeekScreen
 * already refetches on every focus and has its own error-state handling.
 */
let prefetchedForUserId: string | null = null;
let prefetched: Promise<ThisWeekPlan> | null = null;

export function prefetchThisWeek(userId: string): void {
  if (prefetchedForUserId === userId && prefetched) return;
  prefetchedForUserId = userId;
  prefetched = fetchCurrentWeeklyPlan();
  // Swallowed here — a failed prefetch shouldn't surface on its own;
  // loadThisWeekPlan below still surfaces it to whatever consumes it,
  // same as a normal fetchCurrentWeeklyPlan() rejection would.
  prefetched.catch(() => {});
}

function consumePrefetchedThisWeek(userId: string): Promise<ThisWeekPlan> | null {
  if (prefetchedForUserId !== userId) return null;
  const result = prefetched;
  prefetched = null;
  prefetchedForUserId = null;
  return result;
}

/** What ThisWeekScreen actually calls on every load. */
export function loadThisWeekPlan(userId: string | null): Promise<ThisWeekPlan> {
  const pending = userId ? consumePrefetchedThisWeek(userId) : null;
  return pending ?? fetchCurrentWeeklyPlan();
}
