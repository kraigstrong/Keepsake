import { logError, trackEvent } from './index';

// Type-level check, not a runtime one: `tsc --noEmit` (run in CI) fails if
// this line stops being a type error, which is what actually enforces the
// allowlist — trackEvent has no runtime guard against unlisted names.
// @ts-expect-error — not in the AnalyticsEvent allowlist, and must stay a type error.
trackEvent('recipe_ingredients_viewed');

describe('observability abstraction', () => {
  it('logError does not throw for an arbitrary error value', () => {
    expect(() => logError(new Error('boom'), { screen: 'Test' })).not.toThrow();
  });

  it('trackEvent does not throw for an allowlisted event', () => {
    expect(() => trackEvent('app_opened')).not.toThrow();
  });
});
