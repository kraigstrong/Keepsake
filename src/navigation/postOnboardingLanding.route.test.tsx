import { act, type ReactNode } from 'react';

import { router } from 'expo-router';
import { renderRouter, waitFor } from 'expo-router/testing-library';

/**
 * #189 end to end: an account that has just finished onboarding with an
 * empty library lands on Library, not on the This Week it can do nothing
 * with.
 *
 * Driven through the auto-accepting invitation path rather than the
 * create-a-household one because that path completes without a button
 * press — and a `fireEvent.press` on the onboarding screen under
 * `renderRouter` does not take effect in this expo-router /
 * @testing-library/react-native combination (verified independently of
 * this change). What matters here is the *transition* out of onboarding,
 * which is the same either way: it is the only thing that asks for a
 * landing decision.
 *
 * The cold-launch half — an already-onboarded account still opens on
 * This Week — is pinned by navigation.test.tsx and
 * authBoundary.signedIn.test.tsx, which mount straight into an onboarded
 * session and would fail if this ever became a standing rule.
 */

// Filled by accept_invitation, so the refresh that follows sees a
// household where the first load saw none. That transition is what
// carries the app out of the onboarding branch.
let mockHousehold: { id: string; starter_recipes_seeded_at: string | null } | null = null;

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
      if (fn === 'accept_invitation') {
        mockHousehold = { id: 'household-1', starter_recipes_seeded_at: null };
        return { single: () => Promise.resolve({ data: mockHousehold, error: null }) };
      }
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
      if (table === 'households') {
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: mockHousehold, error: null }),
          }),
        };
      }
      if (table === 'recipes') {
        // The empty library that sends this account to Library.
        return {
          select: () => ({
            is: () => ({ is: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
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

// See onboarding.acceptingInvite.test.tsx: mocking expo-linking itself
// hangs the suite, because expo-router uses it internally for routing.
jest.mock('../deepLinks/DeepLinkProvider', () => ({
  DeepLinkProvider: ({ children }: { children: ReactNode }) => children,
  useDeepLink: () => ({
    pendingInvitationToken: 'abcdefghijklmnopqrstuvwxyz012345',
    clearPendingInvitationToken: jest.fn(),
  }),
}));

describe('where a newly onboarded account lands', () => {
  // One renderRouter() for the file, walked through in order: a second
  // call leaves expo-router's route-store singleton inconsistent (see
  // navigation.test.tsx), and these are two points on one journey.
  it('opens on Library, and lets This Week be opened normally afterwards', async () => {
    const app = renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});

    // Asserted on the route, not on rendered content: both tabs stay
    // mounted in a tab navigator, so "This Week is on screen" is true
    // either way and proves nothing. Which route is *active* is the
    // actual question #189 asks.
    await waitFor(() => expect(app.getPathname()).toBe('/library'));

    // The redirect is spent on the way past. Without that, This Week
    // would bounce straight back to Library for as long as the library
    // stayed empty — #189's third acceptance criterion.
    await act(async () => router.navigate('/'));
    await waitFor(() => expect(app.getPathname()).toBe('/'));
  }, 20000);
});
