// initSentry() guards against double-init with module-level state, so
// each test gets a fresh module instance via resetModules() + a dynamic
// require — otherwise a test that initializes Sentry would leak that
// state into every test that runs after it in this file.
jest.mock('@sentry/react-native');

beforeEach(() => {
  jest.resetModules();
});

describe('initSentry', () => {
  it('does not initialize Sentry when no DSN is given', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry(undefined);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes Sentry when a DSN is given', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry('https://example@sentry.io/1');

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://example@sentry.io/1', sendDefaultPii: false }),
    );
  });

  it('does not re-initialize on a second call', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry('https://example@sentry.io/1');
    initSentry('https://example@sentry.io/1');

    expect(Sentry.init).toHaveBeenCalledTimes(1);
  });
});

describe('beforeSend redaction', () => {
  it('redacts keys that look sensitive and leaves others intact', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry('https://example@sentry.io/1');
    const { beforeSend } = Sentry.init.mock.calls[0][0];

    const event = {
      extra: {
        recipeContent: 'garlic bread recipe',
        authToken: 'secret-token',
        cookingNote: 'too much salt',
        screen: 'Settings',
      },
    };

    const result = beforeSend(event);

    expect(result.extra.recipeContent).toBe('[Redacted]');
    expect(result.extra.authToken).toBe('[Redacted]');
    expect(result.extra.cookingNote).toBe('[Redacted]');
    expect(result.extra.screen).toBe('Settings');
  });

  it('leaves events with no extra untouched', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry('https://example@sentry.io/1');
    const { beforeSend } = Sentry.init.mock.calls[0][0];

    const event = {};
    expect(beforeSend(event)).toBe(event);
  });
});

describe('captureException', () => {
  it('forwards the error and context to Sentry', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { captureException } = require('./sentry');

    const error = new Error('boom');
    captureException(error, { screen: 'Test' });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, { extra: { screen: 'Test' } });
  });
});
