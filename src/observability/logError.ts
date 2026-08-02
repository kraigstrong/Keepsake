import { captureException } from './sentry';

/**
 * The only sanctioned way to report an error. Application code must never
 * import Sentry directly — see ADR-0006. Forwards to Sentry when
 * EXPO_PUBLIC_SENTRY_DSN is configured (initSentry(), called once from
 * app/_layout.tsx); a no-op otherwise, so local dev/CI never need a real
 * DSN.
 *
 * Never pass recipe content, cooking notes, or credentials in `context` —
 * PRD §30 and SEC-05 require sensitive content to be excluded from
 * telemetry. Sentry's `beforeSend` hook (src/observability/sentry.ts)
 * scrubs a denylist of key names as defense-in-depth, but callers not
 * passing sensitive data in the first place is the primary guard.
 */
export function logError(error: unknown, context?: Record<string, unknown>): void {
  if (__DEV__) {
    console.error('[logError]', error, context);
  }

  captureException(error, context);
}
