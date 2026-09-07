import { act, renderHook, waitFor } from '@testing-library/react-native';

import { PostOnboardingLandingProvider, usePostOnboardingLanding } from './PostOnboardingLanding';
import { logError } from '../observability';
import * as recipesApi from '../recipes/api';
import { useSession } from '../session/SessionProvider';

jest.mock('../recipes/api');
jest.mock('../session/SessionProvider', () => ({ useSession: jest.fn() }));
// ../recipes/api is auto-mocked above, but Jest still loads the real
// module once to derive its shape — which would otherwise trip
// src/supabase/instance.ts's missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock('../observability', () => ({ logError: jest.fn(), trackEvent: jest.fn() }));

const mockedApi = recipesApi as jest.Mocked<typeof recipesApi>;
const mockedLogError = logError as jest.Mock;
const mockedUseSession = useSession as jest.Mock;

const signedInAs = (id: string) => mockedUseSession.mockReturnValue({ session: { user: { id } } });

beforeEach(() => {
  jest.clearAllMocks();
  signedInAs('user-1');
});
afterEach(() => jest.useRealTimers());

// renderHook is awaited: RTL v14's render is async, and the destructured
// `result` is undefined without it.
const render = () =>
  renderHook(() => usePostOnboardingLanding(), { wrapper: PostOnboardingLandingProvider });

describe('PostOnboardingLandingProvider', () => {
  it('starts idle — nothing happens until onboarding asks it to decide', async () => {
    const { result } = await render();

    expect(result.current.hasLandingDecision).toBe(false);
    expect(result.current.shouldRedirectToLibrary).toBe(false);
    expect(mockedApi.fetchHasAnyRecipes).not.toHaveBeenCalled();
  });

  it('sends an empty library to Library', async () => {
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(false);
    const { result } = await render();

    await act(async () => result.current.decideLanding());

    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(true);
  });

  // The invitee joining a household that already has recipes: This Week
  // is the right screen for them, and it is already the default, so the
  // decision is to do nothing.
  it('leaves a household that already has recipes on This Week', async () => {
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(true);
    const { result } = await render();

    await act(async () => result.current.decideLanding());

    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(false);
  });

  it('holds the splash until the answer is in', async () => {
    let resolve!: (value: boolean) => void;
    mockedApi.fetchHasAnyRecipes.mockReturnValue(
      new Promise<boolean>((r) => {
        resolve = r;
      }),
    );
    const { result } = await render();

    await act(async () => result.current.decideLanding());
    expect(result.current.hasLandingDecision).toBe(false);

    await act(async () => resolve(false));
    expect(result.current.hasLandingDecision).toBe(true);
  });

  // Stranding a new account on the splash would be a far worse failure
  // than opening on the wrong tab.
  it('falls through to This Week when the query fails', async () => {
    mockedApi.fetchHasAnyRecipes.mockRejectedValue(new Error('offline'));
    const { result } = await render();

    await act(async () => result.current.decideLanding());

    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(false);
    expect(mockedLogError).toHaveBeenCalledWith(expect.any(Error), {
      context: 'postOnboardingLanding',
    });
  });

  // supabase-js goes through fetch, which has no default timeout on React
  // Native — a stalled request never settles, and the splash is waiting
  // on this one.
  it('gives up on a stalled query rather than holding the splash forever', async () => {
    jest.useFakeTimers();
    mockedApi.fetchHasAnyRecipes.mockReturnValue(new Promise<boolean>(() => {}));
    const { result } = await render();

    await act(async () => result.current.decideLanding());
    expect(result.current.hasLandingDecision).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(result.current.hasLandingDecision).toBe(true);
    expect(result.current.shouldRedirectToLibrary).toBe(false);
  });

  // The effect that calls this re-runs on state it does not own; a second
  // decision would be a second query, and — worse — could re-raise the
  // redirect after the tab had already consumed it.
  it('decides once, however many times it is asked', async () => {
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(false);
    const { result } = await render();

    await act(async () => result.current.decideLanding());
    await waitFor(() => expect(result.current.shouldRedirectToLibrary).toBe(true));

    await act(async () => result.current.consumeRedirect());
    await act(async () => result.current.decideLanding());

    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(false);
    expect(mockedApi.fetchHasAnyRecipes).toHaveBeenCalledTimes(1);
  });

  // Signing out and onboarding a second account does not restart the
  // process or unmount this provider (Codex, PR #194). Keyed only by a
  // "have we decided yet" flag, the second account would inherit the
  // first's answer and never be asked about its own library.
  it('decides again for a different account on the same process', async () => {
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(true);
    const { result, rerender } = await render();

    await act(async () => result.current.decideLanding());
    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(false);

    signedInAs('user-2');
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(false);
    await act(async () => rerender({}));

    // The previous account's answer must not count as this one's, or the
    // boundary would let the tabs mount before user-2 had been asked.
    expect(result.current.hasLandingDecision).toBe(false);

    await act(async () => result.current.decideLanding());
    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));
    expect(result.current.shouldRedirectToLibrary).toBe(true);
    expect(mockedApi.fetchHasAnyRecipes).toHaveBeenCalledTimes(2);
  });

  // The mirror of prefetch.ts's request fence: a slow request for an
  // account that has since been signed out of must not answer for
  // whoever signed in after it.
  it('ignores a result belonging to an account that has since signed out', async () => {
    let resolveFirst!: (value: boolean) => void;
    mockedApi.fetchHasAnyRecipes.mockReturnValue(
      new Promise<boolean>((r) => {
        resolveFirst = r;
      }),
    );
    const { result, rerender } = await render();

    await act(async () => result.current.decideLanding());

    signedInAs('user-2');
    await act(async () => rerender({}));
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(true);
    await act(async () => result.current.decideLanding());
    await waitFor(() => expect(result.current.hasLandingDecision).toBe(true));

    // user-1's library was empty; applying it would send user-2 — who
    // has recipes — to Library.
    await act(async () => resolveFirst(false));

    expect(result.current.shouldRedirectToLibrary).toBe(false);
  });

  // #189's third acceptance criterion lives here: consuming the redirect
  // is what stops it being a standing "empty library means Library" rule.
  it('drops the redirect once the tab has consumed it', async () => {
    mockedApi.fetchHasAnyRecipes.mockResolvedValue(false);
    const { result } = await render();

    await act(async () => result.current.decideLanding());
    await waitFor(() => expect(result.current.shouldRedirectToLibrary).toBe(true));

    await act(async () => result.current.consumeRedirect());

    expect(result.current.shouldRedirectToLibrary).toBe(false);
  });
});
