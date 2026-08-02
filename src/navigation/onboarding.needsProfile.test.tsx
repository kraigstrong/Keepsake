import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Part of the "household end-to-end" coverage (execution-plan.md Phase 3
// validation) alongside onboarding.needsHousehold/acceptingInvite.test.tsx
// and authBoundary.signedIn/signedOut.test.tsx — together they exercise
// every state app/_layout.tsx's onboarding gate can be in. One
// renderRouter() call per file (see navigation.test.tsx for why); cross-
// household isolation itself is proven separately at the database layer
// by supabase/tests/database/*.test.sql.
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
    // profiles/households both return null — a brand-new signed-in user.
    from: jest.fn(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        in: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    })),
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

describe('onboarding gate — needs a profile', () => {
  it('shows the profile-setup step before anything else', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-profile-step')).toBeOnTheScreen();
    });
  });
});
