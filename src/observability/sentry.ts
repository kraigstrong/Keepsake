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
  });
  initialized = true;
}

// Defense-in-depth, not the only guard — logError's callers are the
// primary one (PRD §30, SEC-05: never pass recipe content, cooking
// notes, or credentials as context). This scrubs anything that slips
// through under a key name that looks sensitive.
const SENSITIVE_KEY_PATTERN = /password|token|credential|secret|recipe|note/i;

function redactSensitiveFields(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        event.extra[key] = '[Redacted]';
      }
    }
  }
  return event;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, { extra: context });
}
