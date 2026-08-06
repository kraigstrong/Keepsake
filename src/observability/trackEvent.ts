import { capture } from './posthog';

/**
 * The only sanctioned way to record an analytics event. Application code
 * must never import PostHog directly — see ADR-0006. PostHog only ever
 * receives events whose name appears in `AnalyticsEvent`; there is no
 * passthrough for arbitrary event names or app state (PRD §30, SEC-05) —
 * enforced at compile time by this type, not by a runtime check (see
 * observability.test.ts's @ts-expect-error case).
 *
 * This is an allowlist, not a registry of what exists yet — Phase 0 has
 * no real features, so it starts near-empty. Add a name here only when
 * the feature that fires it actually ships, and never carry recipe
 * content, cooking notes, or credentials in `props`.
 */
export type AnalyticsEvent =
  | 'app_opened'
  | 'search_performed'
  | 'import_completed'
  | 'import_failed'
  | 'bulk_import_started'
  | 'share_extension_drained'
  | 'photo_import_upload_failed';

export function trackEvent(
  name: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  if (__DEV__) {
    console.log('[trackEvent]', name, props);
  }

  capture(name, props);
}
