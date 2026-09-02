import { normalizeError } from './normalizeError';
import { captureException } from './sentry';

/**
 * The only sanctioned way to report an error. Application code must never
 * import Sentry directly — see ADR-0006. Forwards to Sentry when
 * EXPO_PUBLIC_SENTRY_DSN is configured (initSentry(), called once from
 * app/_layout.tsx); a no-op otherwise, so local dev/CI never need a real
 * DSN.
 *
 * Non-Error values are normalized first (see normalizeError) — Supabase's
 * `{ data, error }` path hands back a plain object, which Sentry would
 * otherwise record with no message and no name.
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

  const normalized = normalizeError(error);
  // Caller context wins on a key collision: it was passed deliberately at
  // the call site, where the extracted fields are a generic fallback.
  captureException(normalized.error, { ...normalized.extra, ...context });
}
