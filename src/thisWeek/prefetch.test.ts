import type { ThisWeekEntry, ThisWeekPlan } from './api';

// prefetchThisWeek/loadThisWeekPlan share module-level singleton state, so
// each test gets a fresh module instance via resetModules() + a dynamic
// require — same reasoning as posthog.test.ts/sentry.test.ts.
jest.mock('./api');
jest.mock('../recipes/heroImage');
// ../recipes/heroImage is auto-mocked above, but Jest still loads the real
// module once to derive its shape — which would otherwise trip its own
// expo-image-picker/expo-image-manipulator/expo-file-system imports and
// src/supabase/instance.ts's missing-env-var throw (same reasoning as
// heroImage.test.ts's own mocks).
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('../supabase/instance', () => ({ supabase: {} }));

beforeEach(() => {
  jest.resetModules();
});

function plan(id: string, entries: ThisWeekEntry[] = []): ThisWeekPlan {
  return { id, status: 'planning', entries };
}

function entry(overrides: Partial<ThisWeekEntry> = {}): ThisWeekEntry {
  return {
    id: overrides.id ?? 'entry-1',
    recipeId: overrides.recipeId ?? 'recipe-1',
    title: overrides.title ?? 'Herb Roast Chicken',
    heroImagePath: 'heroImagePath' in overrides ? overrides.heroImagePath! : null,
    multiplier: overrides.multiplier ?? 1,
    servingsCount: overrides.servingsCount ?? 4,
    position: overrides.position ?? 0,
  };
}

describe('loadThisWeekPlan', () => {
  it('falls back to a fresh fetch when nothing was prefetched', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('fresh'));
    const { loadThisWeekPlan } = require('./prefetch');

    const result = await loadThisWeekPlan('user-1');

    expect(result).toEqual(plan('fresh'));
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(1);
  });

  it('falls back to a fresh fetch when userId is null', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('fresh'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    const result = await loadThisWeekPlan(null);

    expect(result).toEqual(plan('fresh'));
    // The prefetch for user-1 is never consumed by a null-userId caller.
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(2);
  });

  it('consumes a matching prefetch instead of fetching again', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('prefetched'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    const result = await loadThisWeekPlan('user-1');

    expect(result).toEqual(plan('prefetched'));
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(1);
  });

  it('only consumes a prefetch once — the next load fetches fresh', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan
      .mockResolvedValueOnce(plan('prefetched'))
      .mockResolvedValueOnce(plan('second-load'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    await loadThisWeekPlan('user-1');
    const second = await loadThisWeekPlan('user-1');

    expect(second).toEqual(plan('second-load'));
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(2);
  });

  it('does not serve a different userId a stale prefetch', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan
      .mockResolvedValueOnce(plan('user-1-plan'))
      .mockResolvedValueOnce(plan('user-2-plan'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    const result = await loadThisWeekPlan('user-2');

    expect(result).toEqual(plan('user-2-plan'));
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(2);
  });

  it('surfaces a rejected prefetch to the consumer, same as a normal fetch failure', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockRejectedValue(new Error('boom'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');

    await expect(loadThisWeekPlan('user-1')).rejects.toThrow('boom');
  });
});

describe('prefetchThisWeek', () => {
  it('does not start a second fetch for the same userId while one is pending', () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockReturnValue(new Promise(() => {}));
    const { prefetchThisWeek } = require('./prefetch');

    prefetchThisWeek('user-1');
    prefetchThisWeek('user-1');

    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(1);
  });

  it('warms every entry’s hero-image URL as soon as the plan resolves', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [
        entry({ id: 'e1', heroImagePath: 'household-1/a.jpg' }),
        entry({ id: 'e2', heroImagePath: 'household-1/b.jpg' }),
        entry({ id: 'e3', heroImagePath: null }),
      ]),
    );
    heroImage.getHeroImageUrl.mockResolvedValue('https://example.com/signed');
    const { prefetchThisWeek } = require('./prefetch');

    prefetchThisWeek('user-1');
    // Let the plan promise's .then() microtask (which fires the hero
    // fetches) run before asserting.
    await new Promise(process.nextTick);

    expect(heroImage.getHeroImageUrl).toHaveBeenCalledTimes(2);
    expect(heroImage.getHeroImageUrl).toHaveBeenCalledWith('household-1/a.jpg');
    expect(heroImage.getHeroImageUrl).toHaveBeenCalledWith('household-1/b.jpg');
  });

  it('does not throw when a hero-image warm-up fails', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [entry({ heroImagePath: 'household-1/a.jpg' })]),
    );
    heroImage.getHeroImageUrl.mockRejectedValue(new Error('storage down'));
    const { prefetchThisWeek } = require('./prefetch');

    expect(() => prefetchThisWeek('user-1')).not.toThrow();
    await new Promise(process.nextTick);
  });
});
