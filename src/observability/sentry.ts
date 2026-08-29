import * as Sentry from '@sentry/react-native';

/**
 * Only logError.ts calls into this file — see ADR-0006. Sentry's SDK
 * functions are safe no-ops before init() runs, so captureException()
 * doesn't need its own "is this configured" guard; initSentry() simply
 * never calls init() when no DSN is given.
 *
 * Takes the DSN as a parameter rather than reading
 * process.env.EXPO_PUBLIC_SENTRY_DSN directly: babel-preset-expo inlines
 * EXPO_PUBLIC_* vars at build time, not read dynamically at runtime, so a
 * module-level process.env read here would be untestable (setting the
 * env var in a test has no effect on already-transformed code). The one
 * real process.env.EXPO_PUBLIC_SENTRY_DSN read lives in init.ts, at the
 * actual app entry point.
 */
let initialized = false;

export function initSentry(dsn: string | undefined): void {
  if (!dsn || initialized) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    beforeSend: redactSensitiveFields,
    beforeBreadcrumb: stripBreadcrumbUrlQuery,
  });
  initialized = true;
}

// Defense-in-depth, not the only guard — logError's callers are the
// primary one (PRD §30, SEC-05: never pass recipe content, cooking
// notes, or credentials as context). This scrubs anything that slips
// through under a key name that looks sensitive.
const SENSITIVE_KEY_PATTERN = /password|token|credential|secret|recipe|note/i;

// A bare `<thing>Id` is an opaque uuid, not content — redacting recipeId
// costs the debuggability logError's callers pass it for and protects
// nothing, since the id is meaningless without database access.
const OPAQUE_ID_KEY_PATTERN = /^[a-z]+Id$/i;

function redactSensitiveFields(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && !OPAQUE_ID_KEY_PATTERN.test(key)) {
        event.extra[key] = '[Redacted]';
      }
    }
  }
  return event;
}

/**
 * Sentry's own HTTP breadcrumbs record request URLs, and beforeSend never
 * sees them — it only covers `extra`. Every Supabase call this app makes
 * today filters on uuids, so nothing sensitive is in a query string yet;
 * this exists so that stays true without anyone having to remember it
 * when the first `.ilike()` on recipe text gets written. Path is kept —
 * that's what makes a breadcrumb worth having — and the query dropped.
 */
function stripBreadcrumbUrlQuery(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  const url = breadcrumb.data?.url;
  if (typeof url !== 'string') return breadcrumb;

  const queryStart = url.search(/[?#]/);
  if (queryStart === -1) return breadcrumb;

  return { ...breadcrumb, data: { ...breadcrumb.data, url: url.slice(0, queryStart) } };
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, { extra: context });
}
