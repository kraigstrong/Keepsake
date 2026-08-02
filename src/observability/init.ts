import { initPostHog } from './posthog';
import { initSentry } from './sentry';

/**
 * Called once, as early as possible (top of app/_layout.tsx, before the
 * component renders) — Sentry in particular wants init() to run before
 * anything else so it can catch startup errors.
 */
export function initObservability(): void {
  initSentry(process.env.EXPO_PUBLIC_SENTRY_DSN);
  initPostHog(process.env.EXPO_PUBLIC_POSTHOG_KEY, process.env.EXPO_PUBLIC_POSTHOG_HOST);
}
