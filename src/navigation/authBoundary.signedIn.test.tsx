import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// See authBoundary.signedOut.test.tsx for why this is a separate file.
// This suite's whole point is "signed in AND onboarded shows the main
// app", so the profiles/households query mocks below return a real
// row each rather than null — otherwise HouseholdProvider would (rightly)
// route to onboarding instead of (tabs).
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
    from: jest.fn((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: 'test-user', display_name: 'Test User' },
            error: null,
          }),
        })),
        maybeSingle: jest
          .fn()
          .mockResolvedValue(
            table === 'households'
              ? { data: { id: 'household-1' }, error: null }
              : { data: null, error: null },
          ),
      })),
    })),
  },
}));

describe('authenticated route boundary — signed in', () => {
  it('shows This Week instead of sign-in', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
    });
  });
});
