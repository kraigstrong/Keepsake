import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Repro for the 2026-08-31 live test: a signed-out invitee taps
// keepsake:///invite/<token>, the app opens, and lands on a blank screen
// rather than sign-in.
//
// Same single-test-per-file discipline as the other renderRouter suites
// (see navigation.test.tsx).
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

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

describe('invite deep link — signed out', () => {
  it('lands on sign-in, not a blank screen', async () => {
    renderRouter('./app', { initialUrl: `/invite/${TOKEN}` });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('sign-in-screen')).toBeOnTheScreen();
    });
  });
});
