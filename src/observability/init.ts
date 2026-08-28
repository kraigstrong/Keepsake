import { initPostHog } from './posthog';
import { initSentry } from './sentry';

/**
 * Called once, as early as possible (top of app/_layout.tsx, before the
 * component renders) — Sentry in particular wants init() to run before
 * anything else so it can catch startup errors.
 */
// Explicit so the region can't be decided by an SDK default that has
// changed between major versions. Rationale and alternatives:
// docs/roadmap.md's telemetry gate. EXPO_PUBLIC_POSTHOG_HOST overrides.
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

export function initObservability(): void {
  initSentry(process.env.EXPO_PUBLIC_SENTRY_DSN);
  initPostHog(
    process.env.EXPO_PUBLIC_POSTHOG_KEY,
    process.env.EXPO_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  );
}
