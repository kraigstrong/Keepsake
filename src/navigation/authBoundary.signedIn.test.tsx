import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// See authBoundary.signedOut.test.tsx for why this is a separate file.
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
