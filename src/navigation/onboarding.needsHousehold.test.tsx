import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// See onboarding.needsProfile.test.tsx for the shared rationale/context.
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
    // Profile exists, household does not.
    from: jest.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: table === 'profiles' ? { id: 'test-user', display_name: 'Test User' } : null,
              error: null,
            }),
        }),
        in: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    })),
  },
}));

// No pending invitation — the household step should offer create-a-
// household rather than auto-accepting.
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

describe('onboarding gate — has a profile, needs a household', () => {
  it('shows the create-a-household step, not the accepting-invitation state', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-household-step')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('onboarding-accepting-invitation')).toBeNull();
  });
});
