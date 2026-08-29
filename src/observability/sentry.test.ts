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

  it('keeps opaque <thing>Id keys, which carry no content', () => {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');

    initSentry('https://example@sentry.io/1');
    const { beforeSend } = Sentry.init.mock.calls[0][0];

    const result = beforeSend({
      extra: { recipeId: 'ab5f0c62-0000-4000-8000-000000000001', recipeTitle: 'Garlic bread' },
    });

    expect(result.extra.recipeId).toBe('ab5f0c62-0000-4000-8000-000000000001');
    expect(result.extra.recipeTitle).toBe('[Redacted]');
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

describe('beforeBreadcrumb URL scrubbing', () => {
  function getBeforeBreadcrumb() {
    const Sentry = jest.requireMock('@sentry/react-native');
    const { initSentry } = require('./sentry');
    initSentry('https://example@sentry.io/1');
    return Sentry.init.mock.calls[0][0].beforeBreadcrumb;
  }

  it('drops the query string from an HTTP breadcrumb, keeping the path', () => {
    const beforeBreadcrumb = getBeforeBreadcrumb();

    const result = beforeBreadcrumb({
      category: 'xhr',
      data: { url: 'https://x.supabase.co/rest/v1/recipes?title=ilike.*garlic*', method: 'GET' },
    });

    expect(result.data.url).toBe('https://x.supabase.co/rest/v1/recipes');
    expect(result.data.method).toBe('GET');
  });

  it('leaves a breadcrumb with no URL untouched', () => {
    const beforeBreadcrumb = getBeforeBreadcrumb();

    const breadcrumb = { category: 'navigation', data: { from: 'Library', to: 'Recipe' } };
    expect(beforeBreadcrumb(breadcrumb)).toBe(breadcrumb);
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
