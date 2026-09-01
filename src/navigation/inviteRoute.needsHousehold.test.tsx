import { act } from 'react';

import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

// The other half of the 2026-08-31 blank-screen repro: an invitee who has
// signed in and set a display name, but has no household yet. "/" is
// guarded on being fully onboarded, so redirecting there dropped them on
// a blank screen just as it did signed out — see app/invite/[token].tsx.
//
// Unlike onboarding.acceptingInvite.test.tsx this uses the *real*
// DeepLinkProvider, because the thing under test is the route param
// reaching it via capturePendingInvitationToken. Nothing mocks
// expo-linking (which hangs the suite); getInitialURL just resolves to
// nothing here, which is the cold-launch case this path exists to cover.
//
// Single test per file — see navigation.test.tsx.
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
    // Never resolves — proves the screen reaches "accepting" and stays
    // there while the RPC is in flight, without needing it to complete.
    rpc: jest.fn(() => ({ single: () => new Promise(() => {}) })),
  },
}));

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';

describe('invite deep link — signed in, no household yet', () => {
  it('reaches onboarding and auto-accepts, never showing a blank screen', async () => {
    renderRouter('./app', { initialUrl: `/invite/${TOKEN}` });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-accepting-invitation')).toBeOnTheScreen();
    });
    // The irreversible action (ADR-0004) must never have been offered.
    expect(screen.queryByTestId('onboarding-create-household-button')).toBeNull();
  });
});
