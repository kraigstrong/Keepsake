/**
 * Turns whatever a caller passed into something Sentry can actually
 * display. Sentry records a non-Error value as "Object captured as
 * exception with keys: ..." — no message, no name, no stack — which is
 * what every forwarded Supabase error looks like today.
 *
 * The reason is not obvious and is worth stating once: supabase-js only
 * constructs its `PostgrestError` class under `.throwOnError()`. The
 * `{ data, error }` path this app uses returns the raw parsed response
 * body instead, so `result.error` is a plain `{ message, details, hint,
 * code }` object. This cost a real diagnosis on the invite-flow 401
 * (2026-09-01), where the status was only recoverable from an HTTP
 * breadcrumb.
 *
 * `details` is deliberately dropped rather than forwarded. Postgres puts
 * row values there ("Key (household_id, title)=(..., Grandma's Pie)
 * already exists"), which is recipe content under PRD §30 / SEC-05 — and
 * sentry.ts's beforeSend only scrubs `extra`, never the exception
 * message, so anything folded into a message here would be unscrubbable
 * downstream.
 */

export type NormalizedError = { error: Error; extra: Record<string, unknown> };

function named(error: Error, name: string): Error {
  error.name = name;
  return error;
}

/** Distinguishes a Supabase/PostgREST body from any other plain object. */
function looksLikeSupabaseError(record: Record<string, unknown>): boolean {
  return 'code' in record && ('hint' in record || 'details' in record);
}

export function normalizeError(value: unknown): NormalizedError {
  if (value instanceof Error) return { error: value, extra: {} };

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const message =
      typeof record.message === 'string' && record.message !== ''
        ? record.message
        : `Non-Error value captured with keys: ${Object.keys(record).join(', ')}`;

    const extra: Record<string, unknown> = {};
    if (typeof record.code === 'string' && record.code !== '') extra.errorCode = record.code;
    if (typeof record.hint === 'string' && record.hint !== '') extra.errorHint = record.hint;

    const name = looksLikeSupabaseError(record) ? 'SupabaseError' : 'NonErrorException';
    return { error: named(new Error(message), name), extra };
  }

  if (typeof value === 'string' && value !== '') {
    return { error: named(new Error(value), 'NonErrorException'), extra: {} };
  }

  return {
    error: named(new Error(`Non-Error value captured: ${String(value)}`), 'NonErrorException'),
    extra: {},
  };
}
