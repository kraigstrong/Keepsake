// initPostHog() guards against double-init with module-level state, so
// each test gets a fresh module instance via resetModules() + a dynamic
// require — same reasoning as sentry.test.ts. The explicit jest.mock()
// call re-establishes the manual mock (__mocks__/posthog-react-native.js)
// after resetModules() clears its automatic association.
jest.mock('posthog-react-native');

beforeEach(() => {
  jest.resetModules();
});

describe('initPostHog', () => {
  it('does not create a client when no API key is given', () => {
    const PostHog = jest.requireMock('posthog-react-native');
    const { initPostHog } = require('./posthog');

    initPostHog(undefined, undefined);

    expect(PostHog).not.toHaveBeenCalled();
  });

  it('creates a client when an API key is given', () => {
    const PostHog = jest.requireMock('posthog-react-native');
    const { initPostHog } = require('./posthog');

    initPostHog('phc_test_key', 'https://posthog.example.com');

    expect(PostHog).toHaveBeenCalledWith('phc_test_key', {
      host: 'https://posthog.example.com',
    });
  });

  it('does not create a second client on a second call', () => {
    const PostHog = jest.requireMock('posthog-react-native');
    const { initPostHog } = require('./posthog');

    initPostHog('phc_test_key', undefined);
    initPostHog('phc_test_key', undefined);

    expect(PostHog).toHaveBeenCalledTimes(1);
  });
});

describe('capture', () => {
  it('does nothing when no client was ever initialized', () => {
    const { capture } = require('./posthog');

    expect(() => capture('app_opened')).not.toThrow();
  });

  it('forwards the event name and props to the client', () => {
    const PostHog = jest.requireMock('posthog-react-native');
    const { initPostHog, capture } = require('./posthog');

    initPostHog('phc_test_key', undefined);
    capture('app_opened', { source: 'test' });

    expect(PostHog.mockCapture).toHaveBeenCalledWith('app_opened', { source: 'test' });
  });
});
