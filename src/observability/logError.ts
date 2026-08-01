/**
 * The only sanctioned way to report an error. Application code must never
 * import Sentry directly — see ADR-0006. Sentry wiring (DSN init,
 * `beforeSend` redaction) lands in Phase 2 alongside the app shell; until
 * then, and whenever no DSN is configured, this logs to the console so
 * local development still surfaces errors.
 *
 * Never pass recipe content, cooking notes, or credentials in `context` —
 * PRD §30 and SEC-05 require sensitive content to be excluded from
 * telemetry. Phase 2's Sentry `beforeSend` hook enforces this
 * server-side once wired; until then, callers are the only guard.
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  if (__DEV__) {
    console.error('[logError]', error, context);
  }

  // Phase 2: forward to Sentry when EXPO_PUBLIC_SENTRY_DSN is configured.
}
