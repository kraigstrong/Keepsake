// Must run before the testing-library import below registers its
// automatic per-test cleanup — this file renders once in beforeAll and
// navigates across tests rather than re-rendering per test (see the
// comment further down for why).
import '@testing-library/react-native/dont-cleanup-after-each';

import { act } from 'react';

import { router } from 'expo-router';
import { cleanup, renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Deliberately lives outside app/ — Expo Router's context scanner treats
// every file under app/ as a candidate route, so a colocated test file
// would corrupt the real route tree it's trying to test.
//
// This suite exercises tab/header navigation, which only exists behind
// the authenticated route boundary — a signed-in, onboarded session is
// mocked here (real profile/household rows, not null) so neither the
// auth boundary nor the onboarding gate is what's under test. See
// authBoundary.signedIn/signedOut.test.tsx for the redirect behavior.
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
      // household_membership
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ user_id: 'test-user' }], error: null }),
        }),
      };
    }),
  },
}));
//
// One renderRouter() call for the whole file, navigated with the plain
// imperative `router` API and asserted through waitFor rather than a
// direct synchronous check. Works around two real version-mismatch bugs
// in this expo-router/@testing-library/react-native combination:
// renderRouter() doesn't await RTL v14's now-async render() (a second
// renderRouter() call per file leaves the global route-store singleton
// inconsistent — hence one render, navigated between, rather than one
// render per test), and testRouter.navigate()'s built-in matcher calls
// methods that only exist on renderRouter()'s return value, not on the
// `screen` export it actually asserts against (hence the plain `router`
// API instead). waitFor rides out whatever's still settling after each
// navigate() call rather than assuming one `act()` flush is enough.
//
// A harmless "overlapping act() calls" console.error survives all this —
// traced to renderRouter()'s own unawaited render() promise resolving
// late, not to anything in this file. All assertions pass and check real
// rendered content, not a swallowed failure.
describe('app navigation shell', () => {
  // Explicit timeout (not jest.config.js's testTimeout, which CI has shown
  // isn't honored per-project in this multi-project setup) — CI's slower/
  // more variable runners need real headroom beyond the 5000ms default for
  // renderRouter()'s full settle, especially with the tab bar now doing
  // real SVG rendering work (Phase 3.5).
  beforeAll(async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
    });
  }, 20000);

  it('renders This Week as the default screen', () => {
    expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
  });

  it('renders the Library tab on navigation', async () => {
    act(() => router.navigate('/library'));
    await waitFor(() => {
      expect(screen.getByTestId('library-placeholder')).toBeOnTheScreen();
    });
  });

  it('renders Settings, reached outside the tab bar', async () => {
    act(() => router.navigate('/settings'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-placeholder')).toBeOnTheScreen();
    });
  });

  afterAll(() => cleanup());
});
