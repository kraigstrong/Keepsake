import { act, type ReactNode } from 'react';

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
    // Never resolves within this test — proves the screen reaches the
    // "accepting" state and stays there while the RPC is in flight,
    // rather than needing the acceptance to actually complete.
    rpc: jest.fn(() => ({ single: () => new Promise(() => {}) })),
  },
}));

// Mocking expo-linking directly (rather than DeepLinkProvider) hangs this
// suite — expo-router uses expo-linking internally for its own routing,
// and a minimal mock doesn't satisfy what it needs. DeepLinkProvider's
// own URL-parsing (cold start + warm "url" event) is covered in isolation
// by src/deepLinks/DeepLinkProvider.test.tsx instead; here we only need a
// fixed "there's a pending token" context value.
jest.mock('../deepLinks/DeepLinkProvider', () => ({
  DeepLinkProvider: ({ children }: { children: ReactNode }) => children,
  useDeepLink: () => ({
    pendingInvitationToken: 'abcdefghijklmnopqrstuvwxyz012345',
    clearPendingInvitationToken: jest.fn(),
  }),
}));

describe('onboarding gate — has a profile, needs a household, has a pending invitation', () => {
  // Explicit timeout — see navigation.test.tsx for why (CI-only flakiness
  // against the 5000ms default, jest.config.js's testTimeout isn't
  // honored per-project here).
  it('auto-accepts instead of showing the create-a-household button', async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-accepting-invitation')).toBeOnTheScreen();
    });
    expect(screen.queryByTestId('onboarding-create-household-button')).toBeNull();
  }, 20000);
});
