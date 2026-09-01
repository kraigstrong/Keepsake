import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// The third of app/invite/[token].tsx's three branches, and the only one
// that already worked — an invite tapped on a device that's already in a
// household. It's pinned here because that is exactly how the route got
// signed off in the first place: verified from an onboarded phone, where
// "/" exists, while the two states a real invitee is in were both blank
// (see the sibling inviteRoute.* suites).
//
// Mocks mirror authBoundary.signedIn.test.tsx — a full profile, household
// and membership, so HouseholdProvider reports onboarded rather than
// routing to onboarding. Single test per file, see navigation.test.tsx.
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
      if (table === 'households') {
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: 'household-1' }, error: null }),
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
      // household_membership
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ user_id: 'test-user' }], error: null }),
        }),
      };
    }),
  },
}));

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

describe('invite deep link — already onboarded', () => {
  // Explicit timeout — see navigation.test.tsx.
  it('lands in the app rather than sitting on the invite route', async () => {
    renderRouter('./app', { initialUrl: `/invite/${TOKEN}` });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
    });
  }, 20000);
});
