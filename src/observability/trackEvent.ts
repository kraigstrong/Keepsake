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
  | 'photo_import_upload_failed'
  // Core loops, added for Friends & Family Preview (2026-08-27). The
  // question these answer is "which parts of the app do people actually
  // reach", not a step-by-step funnel — deliberately coarse for a
  // handful of households. Paired start/finish names exist only where
  // the gap between them is the interesting signal (opening Cooking
  // Mode but never recording a cook).
  | 'recipe_saved'
  | 'weekly_plan_confirmed'
  | 'cooking_started'
  | 'cooking_completed'
  | 'grocery_list_generated'
  | 'grocery_list_exported'
  // Smart Meal Selection. Names and props are fixed by the proposal's
  // §11, not chosen here. Its group-flow events
  // (selection_participant_completed, selection_round_closed,
  // selection_results_viewed, selection_no_match) are deliberately
  // absent: the group flow isn't built, so they could never fire, and
  // an allowlist entry that can't fire is indistinguishable from one
  // that's broken. Add them with the feature.
  | 'selection_round_started'
  | 'selection_round_applied'
  | 'selection_round_cancelled'
  | 'selection_deck_exhausted'
  | 'selection_technical_failure'
  // Starter recipes. The pair is the conversion rate on the one-tap
  // offer: how many empty libraries saw it, how many took it.
  | 'starter_recipes_offered'
  | 'starter_recipes_added';

export function trackEvent(
  name: AnalyticsEvent,
  props?: Record<string, string | number | boolean>,
): void {
  if (__DEV__) {
    console.log('[trackEvent]', name, props);
  }

  capture(name, props);
}
