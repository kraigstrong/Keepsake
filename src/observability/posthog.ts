import PostHog from 'posthog-react-native';

/**
 * Only trackEvent.ts calls into this file — see ADR-0006. The allowlist
 * itself is enforced at compile time by trackEvent's AnalyticsEvent
 * union type, not here; this file's only job is the no-op-until-
 * configured behavior.
 *
 * Takes the API key/host as parameters rather than reading
 * process.env.EXPO_PUBLIC_POSTHOG_* directly — see sentry.ts's initSentry
 * for why (babel-preset-expo inlines these at build time, not runtime).
 */
let client: PostHog | null = null;

export function initPostHog(apiKey: string | undefined, host: string | undefined): void {
  if (!apiKey || client) return;

  client = new PostHog(apiKey, { host });
}

export function capture(name: string, props?: Record<string, string | number | boolean>): void {
  client?.capture(name, props);
}
