import { initPostHog } from './posthog';
import { initSentry } from './sentry';

/**
 * Called once, as early as possible (top of app/_layout.tsx, before the
 * component renders) — Sentry in particular wants init() to run before
 * anything else so it can catch startup errors.
 */
/**
 * US cloud (developer decision, 2026-08-27). Defaulted here rather than
 * left to the SDK: posthog-react-native's own fallback host has changed
 * between major versions (app.posthog.com -> us.i.posthog.com), and
 * deciding where analytics data lands by way of a dependency's default
 * is not a decision, it's an accident. EXPO_PUBLIC_POSTHOG_HOST still
 * overrides — that's the hook for a reverse proxy or an EU move.
 */
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export function initObservability(): void {
  initSentry(process.env.EXPO_PUBLIC_SENTRY_DSN);
  initPostHog(
    process.env.EXPO_PUBLIC_POSTHOG_KEY,
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  );
}
