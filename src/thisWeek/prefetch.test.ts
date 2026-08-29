import { Image } from 'react-native';

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
  jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

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

  // Replaces a test that asserted the rejection was surfaced — that was
  // the contract this changed deliberately, not a regression.
  it('retries a rejected prefetch with a fresh fetch instead of surfacing it', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan
      .mockRejectedValueOnce(new Error('caller does not belong to a household'))
      .mockResolvedValueOnce(plan('recovered'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');

    await expect(loadThisWeekPlan('user-1')).resolves.toEqual(plan('recovered'));
    expect(api.fetchCurrentWeeklyPlan).toHaveBeenCalledTimes(2);
  });

  it('still surfaces the error when the retry fails too', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockRejectedValue(new Error('offline'));
    const { prefetchThisWeek, loadThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');

    await expect(loadThisWeekPlan('user-1')).rejects.toThrow('offline');
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

  it('warms every entry’s hero-image URL as soon as the plan resolves, in one batched call', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [
        entry({ id: 'e1', heroImagePath: 'household-1/a.jpg' }),
        entry({ id: 'e2', heroImagePath: 'household-1/b.jpg' }),
        entry({ id: 'e3', heroImagePath: null }),
      ]),
    );
    heroImage.getHeroImageUrls.mockResolvedValue({
      'household-1/a.jpg': 'https://example.com/a',
      'household-1/b.jpg': 'https://example.com/b',
    });
    const { prefetchThisWeek } = require('./prefetch');

    prefetchThisWeek('user-1');
    // Let the plan promise's .then() microtask (which fires the hero
    // fetch) run before asserting.
    await new Promise(process.nextTick);

    expect(heroImage.getHeroImageUrls).toHaveBeenCalledTimes(1);
    expect(heroImage.getHeroImageUrls).toHaveBeenCalledWith([
      'household-1/a.jpg',
      'household-1/b.jpg',
    ]);
  });

  it('prefetches each resolved image URL into the native image cache', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [entry({ id: 'e1', heroImagePath: 'household-1/a.jpg' })]),
    );
    heroImage.getHeroImageUrls.mockResolvedValue({ 'household-1/a.jpg': 'https://example.com/a' });
    const { prefetchThisWeek } = require('./prefetch');

    prefetchThisWeek('user-1');
    // A full task flush — getHeroImageUrls resolving and then
    // Image.prefetch being called off its result are two separate
    // microtask layers.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Image.prefetch).toHaveBeenCalledWith('https://example.com/a');
  });

  it('does not call getHeroImageUrls when no entry has a hero image', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('p1', [entry({ heroImagePath: null })]));
    const { prefetchThisWeek } = require('./prefetch');

    prefetchThisWeek('user-1');
    await new Promise(process.nextTick);

    expect(heroImage.getHeroImageUrls).not.toHaveBeenCalled();
  });

  it('does not throw when a hero-image warm-up fails', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [entry({ heroImagePath: 'household-1/a.jpg' })]),
    );
    heroImage.getHeroImageUrls.mockRejectedValue(new Error('storage down'));
    const { prefetchThisWeek } = require('./prefetch');

    expect(() => prefetchThisWeek('user-1')).not.toThrow();
    await new Promise(process.nextTick);
  });
});

describe('peekPrefetchedThisWeekPlan', () => {
  it('returns null when nothing was prefetched', () => {
    const { peekPrefetchedThisWeekPlan } = require('./prefetch');

    expect(peekPrefetchedThisWeekPlan('user-1')).toBeNull();
  });

  it('returns null when userId is null', () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('p1'));
    const { prefetchThisWeek, peekPrefetchedThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');

    expect(peekPrefetchedThisWeekPlan(null)).toBeNull();
  });

  it('returns null while the prefetch is still pending', () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockReturnValue(new Promise(() => {}));
    const { prefetchThisWeek, peekPrefetchedThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');

    expect(peekPrefetchedThisWeekPlan('user-1')).toBeNull();
  });

  it('returns the resolved plan once the prefetch settles', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('p1'));
    const { prefetchThisWeek, peekPrefetchedThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    await new Promise(process.nextTick);

    expect(peekPrefetchedThisWeekPlan('user-1')).toEqual(plan('p1'));
  });

  it('does not serve a different userId a resolved plan', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockResolvedValue(plan('p1'));
    const { prefetchThisWeek, peekPrefetchedThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-1');
    await new Promise(process.nextTick);

    expect(peekPrefetchedThisWeekPlan('user-2')).toBeNull();
  });

  it('does not let a slower earlier request overwrite a faster later one (cross-account fence)', async () => {
    // Reproduces a real sign-out/sign-in in quick succession: account A's
    // fetch is kicked off first but resolves *after* account B's, which
    // was started second. Without a per-request token, A's late .then()
    // would overwrite prefetchedPlanResult with A's plan while
    // prefetchedForUserId still correctly reads "B" — handing account B
    // account A's recipe titles and cache-warmed photos.
    const api = jest.requireMock('./api');
    let resolveA!: (value: ThisWeekPlan) => void;
    api.fetchCurrentWeeklyPlan.mockReturnValueOnce(
      new Promise<ThisWeekPlan>((resolve) => (resolveA = resolve)),
    );
    api.fetchCurrentWeeklyPlan.mockResolvedValueOnce(plan('user-B-plan'));
    const { prefetchThisWeek, peekPrefetchedThisWeekPlan } = require('./prefetch');

    prefetchThisWeek('user-A');
    prefetchThisWeek('user-B');
    await new Promise(process.nextTick);
    expect(peekPrefetchedThisWeekPlan('user-B')).toEqual(plan('user-B-plan'));

    // Account A's slower request finally resolves, after B's already won.
    resolveA(plan('user-A-plan'));
    await new Promise(process.nextTick);

    expect(peekPrefetchedThisWeekPlan('user-B')).toEqual(plan('user-B-plan'));
  });
});

describe('waitForThisWeekPrefetch', () => {
  it('resolves immediately when nothing was prefetched', async () => {
    const { waitForThisWeekPrefetch } = require('./prefetch');

    await expect(waitForThisWeekPrefetch('user-1', 1000)).resolves.toBeUndefined();
  });

  it('resolves immediately for a userId that does not match the prefetch', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockReturnValue(new Promise(() => {}));
    const { prefetchThisWeek, waitForThisWeekPrefetch } = require('./prefetch');

    prefetchThisWeek('user-1');

    await expect(waitForThisWeekPrefetch('user-2', 1000)).resolves.toBeUndefined();
  });

  it('waits for the plan and hero-image warm-up to both settle', async () => {
    const api = jest.requireMock('./api');
    const heroImage = jest.requireMock('../recipes/heroImage');
    let resolveHeroWarm!: () => void;
    api.fetchCurrentWeeklyPlan.mockResolvedValue(
      plan('p1', [entry({ heroImagePath: 'household-1/a.jpg' })]),
    );
    heroImage.getHeroImageUrls.mockReturnValue(
      new Promise((resolve) => {
        resolveHeroWarm = () => resolve({});
      }),
    );
    const { prefetchThisWeek, waitForThisWeekPrefetch } = require('./prefetch');

    prefetchThisWeek('user-1');
    let settled = false;
    waitForThisWeekPrefetch('user-1', 5000).then(() => (settled = true));
    await new Promise(process.nextTick);
    expect(settled).toBe(false);

    resolveHeroWarm();
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);
    expect(settled).toBe(true);
  });

  it('times out instead of waiting forever on a slow prefetch', async () => {
    const api = jest.requireMock('./api');
    api.fetchCurrentWeeklyPlan.mockReturnValue(new Promise(() => {}));
    const { prefetchThisWeek, waitForThisWeekPrefetch } = require('./prefetch');

    prefetchThisWeek('user-1');

    await expect(waitForThisWeekPrefetch('user-1', 10)).resolves.toBeUndefined();
  });
});
