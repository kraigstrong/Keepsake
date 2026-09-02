import { logError } from './logError';
import { captureException } from './sentry';

// babel-jest hoists this above the imports, so the mock is in place
// before logError binds captureException.
jest.mock('./sentry');

const captureExceptionMock = captureException as jest.MockedFunction<typeof captureException>;

/** Fails loudly rather than destructuring a possibly-absent call. */
function lastCall(): [unknown, Record<string, unknown> | undefined] {
  expect(captureExceptionMock).toHaveBeenCalled();
  const call = captureExceptionMock.mock.calls[0];
  if (!call) throw new Error('captureException was not called');
  return [call[0], call[1]];
}

beforeEach(() => {
  captureExceptionMock.mockClear();
});

describe('logError', () => {
  it('forwards a real Error unchanged, with the caller context', () => {
    const error = new Error('boom');

    logError(error, { context: 'householdInitialLoad' });

    expect(captureExceptionMock).toHaveBeenCalledWith(error, {
      context: 'householdInitialLoad',
    });
  });

  // The regression this module exists for: a forwarded Supabase error used
  // to reach Sentry as "Object captured as exception with keys: code,
  // details, hint, message" — no message, no name, nothing to group on.
  it('turns a forwarded Supabase error into something Sentry can display', () => {
    logError(
      { message: 'JWT expired', details: null, hint: null, code: 'PGRST301' },
      { context: 'householdInitialLoad' },
    );

    const [captured, options] = lastCall();

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('JWT expired');
    expect((captured as Error).name).toBe('SupabaseError');
    expect(options).toEqual({ errorCode: 'PGRST301', context: 'householdInitialLoad' });
  });

  it('lets caller context win over an extracted field on a collision', () => {
    logError(
      { message: 'nope', details: null, hint: null, code: 'PGRST301' },
      { errorCode: 'caller-supplied' },
    );

    const [, options] = lastCall();
    expect(options).toEqual({ errorCode: 'caller-supplied' });
  });

  it('does not throw when called with no context', () => {
    expect(() => logError('bare string')).not.toThrow();
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
