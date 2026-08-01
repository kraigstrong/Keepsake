# ADR-0006: Error tracking, analytics, and feature-flag approach

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

Phase 0 build scope calls for "error and analytics abstractions" and "feature flags" without naming vendors — another explicitly delegated choice (see ADR-0005 for the delegation source). The PRD's non-negotiables (§30) require sensitive content — recipe content, cooking notes, credentials — to be excluded from logs and analytics (also SEC-05 in `docs/prd-traceability.md`), which narrows the field to tools that support redaction and an explicit event allowlist rather than free-form event capture.

## Decision

- **Error tracking: Sentry**, via `@sentry/react-native`. Mature Expo integration (config plugin, source-map upload for readable native stack traces), and its `beforeSend` hook is the mechanism the app-shell phase (Phase 2) will use to enforce redacted logging before anything leaves the device.
- **Analytics: PostHog**, via `posthog-react-native`. Supports an explicit event allowlist model rather than auto-capturing arbitrary app state, which maps directly onto Phase 2's "Analytics event allowlist" build-scope item — the abstraction this phase adds is deliberately a single `trackEvent(name, props)` function that only forwards names present in that allowlist, not a passthrough to the vendor SDK.
- **Feature flags: no third-party service.** A minimal typed flag module (a plain object of `{flagName: boolean}` read from local config, with a documented path to swap the read for a remote source later if a real operational need appears) is proportionate to a single-developer project at this stage. This phase's job is establishing the *pattern* — flag definitions live in one place, every flag has a removal owner — not standing up remote flag infrastructure.
- **Both Sentry and PostHog integrations are stubbed as no-ops when their DSN/API key env vars are absent**, so local development and CI never require live vendor credentials to run the app or test suite.

## Alternatives considered

- **Bugsnag / Rollbar** instead of Sentry: comparable feature set, no clear advantage; Sentry's Expo-specific documentation and config-plugin maturity tipped it.
- **Amplitude / Mixpanel** instead of PostHog: PostHog's self-hostability is a meaningful future option if household recipe/cooking data ever makes a third-party analytics processor a harder sell, and its EU-hostable/self-hosted deployment options give more flexibility than most competitors without a redesign later.
- **LaunchDarkly / Statsig** for feature flags: real feature-flag platforms, but disproportionate for a project at this stage — introduces a paid vendor relationship and a new credential to manage for a need currently served by a JSON object. Revisit if remote, per-user flag targeting becomes an actual requirement (e.g., staged rollouts once there are real users).

## Consequences

- Server-side code and client code both go through the same thin `logError` / `trackEvent` wrappers — nothing in application code calls `Sentry.*` or `PostHog.*` directly, so the redaction and allowlist rules in Phase 2 have exactly one place to enforce.
- Both Sentry and PostHog need API keys/DSNs eventually (client-safe values — Sentry DSNs and PostHog project keys are both meant to ship in client bundles, unlike the Supabase/Anthropic secrets discussed earlier this session), but neither is required to start Phase 0 or Phase 1 work — they activate whenever the developer creates the accounts and adds the values to the `Keepsake Client` 1Password Environment.
- Revisit the in-house feature-flag approach if a flag needs to change without a redeploy (current design requires a new build to change a flag value) — that's the concrete trigger for reconsidering a remote-config-backed approach.
