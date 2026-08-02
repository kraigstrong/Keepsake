import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Deliberately lives outside app/ (see navigation.test.tsx for why), and
// deliberately its own file rather than a second describe block alongside
// authBoundary.signedIn.test.tsx — renderRouter's real render() is only
// reliable once per test file (see navigation.test.tsx for the
// underlying version-mismatch bugs this works around).
jest.mock('../supabase/instance', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
  },
}));

describe('authenticated route boundary — signed out', () => {
  it('redirects to sign-in instead of showing the tabs', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('sign-in-screen')).toBeOnTheScreen();
    });
  });
});
