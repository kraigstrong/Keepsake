import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

/**
 * The other half of #189, and the one that is easy to break: an
 * established account with an *empty* library still opens on This Week.
 * Landing on Library is a one-time post-onboarding action, not a
 * standing "the library is empty" rule.
 *
 * This exists because the first version of that guard keyed off
 * `needsOnboarding`, which is derived from profile/household being null
 * — also true on every cold launch while the household load is in
 * flight. Every launch of an emptied account was therefore re-routed
 * (Codex, PR #194). navigation.test.tsx did not catch it: its `recipes`
 * mock has no `.is()`, so the library probe threw, was caught, and was
 * read as "has recipes". The mock below is deliberately the shape the
 * probe actually calls, and the library is deliberately empty — the
 * exact conditions under which the bug fired.
 */
// Counts calls to the library probe specifically (`.is().is().limit()`),
// which is the shape only fetchHasAnyRecipes uses. Asserting on this
// rather than on the resulting pathname keeps the test deterministic:
// "the redirect has not happened yet" is true of a broken build too, for
// as long as its query is still in flight.
let mockProbeCalls = 0;

jest.mock('../supabase/instance', () => ({
  supabase: {
    auth: {
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null }),
      onAuthStateChange: jest
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
    rpc: jest.fn((fn: string) => {
      if (fn === 'get_or_create_current_weekly_plan') {
        return {
          single: () =>
            Promise.resolve({ data: { id: 'plan-1', status: 'planning' }, error: null }),
        };
      }
      return { single: () => Promise.resolve({ data: null, error: new Error('not mocked') }) };
    }),
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'test-user', display_name: 'Test User' },
                  error: null,
                }),
            }),
            in: () =>
              Promise.resolve({
                data: [{ id: 'test-user', display_name: 'Test User' }],
                error: null,
              }),
          }),
        };
      }
      // Already onboarded: this account never passes through onboarding.
      //
      // Resolved a tick late, on purpose. Resolving immediately lets the
      // session and the household land in one batch, so React never
      // commits the render where the session exists but the household is
      // still loading — and that render *is* the bug: profile/household
      // are null there, which is indistinguishable from a new account if
      // you only look at those two fields. A mock that skips it cannot
      // fail on the thing this test exists to catch.
      if (table === 'households') {
        return {
          select: () => ({
            maybeSingle: () =>
              new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      data: { id: 'household-1', starter_recipes_seeded_at: null },
                      error: null,
                    }),
                  0,
                ),
              ),
          }),
        };
      }
      if (table === 'recipes') {
        return {
          select: () => ({
            is: () => ({
              is: () => ({
                limit: () => {
                  mockProbeCalls += 1;
                  return Promise.resolve({ data: [], error: null });
                },
              }),
            }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === 'planning_entries') {
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ user_id: 'test-user' }], error: null }),
        }),
      };
    }),
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

beforeEach(() => {
  mockProbeCalls = 0;
});

describe('cold launch of an already-onboarded account', () => {
  it('never asks about the library, and stays on This Week', async () => {
    const app = renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});

    // Waits for the app itself, not just for the pathname: while the
    // splash is up the pathname is already '/', so asserting on it alone
    // would pass without the launch ever completing.
    await waitFor(() => expect(screen.getByTestId('this-week-screen')).toBeOnTheScreen());

    // Settle everything still in flight, so a late redirect cannot pass
    // as "never happened".
    for (let i = 0; i < 5; i += 1) await act(async () => {});

    // The load-bearing assertion: an account that did not just onboard
    // is never asked, so it can never be re-routed however empty its
    // library is.
    expect(mockProbeCalls).toBe(0);
    expect(app.getPathname()).toBe('/');
  }, 20000);
});
