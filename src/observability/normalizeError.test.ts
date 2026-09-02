import { normalizeError } from './normalizeError';

// The exact shape supabase-js hands back on a non-2xx: the raw parsed
// response body, not a PostgrestError instance.
const postgrestError = {
  message: 'JWT expired',
  details: null,
  hint: null,
  code: 'PGRST301',
};

describe('normalizeError', () => {
  it('passes a real Error through untouched, preserving its stack', () => {
    const error = new Error('boom');
    const result = normalizeError(error);

    expect(result.error).toBe(error);
    expect(result.extra).toEqual({});
  });

  it('gives a Supabase error a readable message and name', () => {
    const { error, extra } = normalizeError(postgrestError);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('JWT expired');
    expect(error.name).toBe('SupabaseError');
    expect(extra).toEqual({ errorCode: 'PGRST301' });
  });

  it('carries a non-null hint through as context', () => {
    const { extra } = normalizeError({
      message: 'column recipes.titel does not exist',
      details: null,
      hint: 'Perhaps you meant recipes.title',
      code: '42703',
    });

    expect(extra).toEqual({ errorCode: '42703', errorHint: 'Perhaps you meant recipes.title' });
  });

  // The SEC-05 guard. Postgres puts row values in `details`, and
  // sentry.ts's beforeSend only scrubs `extra` — never the exception
  // message — so `details` must not reach either one.
  it('never forwards `details`, which carries row values', () => {
    const { error, extra } = normalizeError({
      message: 'duplicate key value violates unique constraint "recipes_household_title_key"',
      details:
        "Key (household_id, title)=(a0000000-0000-4000-8000-000000000001, Grandma's Pie) already exists.",
      hint: null,
      code: '23505',
    });

    expect(error.message).not.toContain("Grandma's Pie");
    expect(JSON.stringify(extra)).not.toContain("Grandma's Pie");
    expect(extra).toEqual({ errorCode: '23505' });
  });

  it('lists the keys when a plain object has no usable message', () => {
    const { error } = normalizeError({ code: 'PGRST301', hint: null });

    expect(error.message).toBe('Non-Error value captured with keys: code, hint');
    expect(error.name).toBe('SupabaseError');
  });

  it('distinguishes an ordinary object from a Supabase one', () => {
    const { error } = normalizeError({ message: 'something odd' });

    expect(error.message).toBe('something odd');
    expect(error.name).toBe('NonErrorException');
  });

  it('handles a thrown string', () => {
    const { error } = normalizeError('plain string failure');

    expect(error.message).toBe('plain string failure');
    expect(error.name).toBe('NonErrorException');
  });

  it.each([
    [null, 'Non-Error value captured: null'],
    [undefined, 'Non-Error value captured: undefined'],
    [42, 'Non-Error value captured: 42'],
    ['', 'Non-Error value captured: '],
  ])('handles the primitive %p', (value, expected) => {
    expect(normalizeError(value).error.message).toBe(expected);
  });
});
