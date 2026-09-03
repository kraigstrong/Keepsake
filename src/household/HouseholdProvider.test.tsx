import { act, renderHook, waitFor } from '@testing-library/react-native';

import { HouseholdProvider, useHousehold } from './HouseholdProvider';
import * as api from './api';
import { logError } from '../observability';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
jest.mock('../session/SessionProvider', () => ({
  useSession: jest.fn(),
}));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));
jest.mock('../observability', () => ({ logError: jest.fn() }));

const mockedUseSession = useSession as jest.Mock;
const mockedApi = api as jest.Mocked<typeof api>;
const mockedLogError = logError as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseSession.mockReturnValue({ session: { user: { id: 'user-1' } } });
});

// The load retries with real delays before giving up, so the tests that
// drive it to failure run on fake timers rather than waiting ~1.2s each.
afterEach(() => {
  jest.useRealTimers();
});

// waitFor advances fake timers, but only within its own budget — the
// default 1000ms stops short of the load's full 300ms+900ms retry chain,
// which reads as "still loading" rather than as the timeout it is.
const RETRY_BUDGET_MS = 5000;

describe('HouseholdProvider / useHousehold', () => {
  it('resolves profile and household to null when the user has neither', async () => {
    mockedApi.fetchProfile.mockResolvedValue(null);
    mockedApi.fetchHousehold.mockResolvedValue(null);

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.household).toBeNull();
  });

  it('resolves an existing profile and household', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold.mockResolvedValue({ id: 'household-1', starterRecipesSeededAt: null });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toEqual({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    expect(result.current.household).toEqual({ id: 'household-1', starterRecipesSeededAt: null });
  });

  it('does not fetch when there is no session', async () => {
    mockedUseSession.mockReturnValue({ session: null });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.household).toBeNull();
    expect(mockedApi.fetchProfile).not.toHaveBeenCalled();
  });

  it('a failed initial load stops loading and reports an error instead of hanging', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockRejectedValue(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: RETRY_BUDGET_MS });
    expect(result.current.loadError).toBe(true);
    expect(mockedLogError).toHaveBeenCalled();
  });

  it('a failed initial load does not report the user as having no household', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockRejectedValue(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: RETRY_BUDGET_MS });
    expect(result.current.household).toBeNull();
    expect(result.current.loadError).toBe(true);
  });

  it('retryLoad clears the error and recovers when the fetch succeeds', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockRejectedValue(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.loadError).toBe(true), { timeout: RETRY_BUDGET_MS });

    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'metric',
    });
    mockedApi.fetchHousehold.mockResolvedValue({ id: 'household-1', starterRecipesSeededAt: null });

    await act(async () => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(result.current.loadError).toBe(false), { timeout: RETRY_BUDGET_MS });
    expect(result.current.household).toEqual({ id: 'household-1', starterRecipesSeededAt: null });
  });

  // The invitee case (2026-09-01): a first fetch that fails right after
  // OTP sign-in must not put a brand-new user on an error screen when the
  // very next attempt would have worked.
  it('recovers from a transient first failure without surfacing an error', async () => {
    jest.useFakeTimers();
    const profile = { id: 'user-1', displayName: 'Alice', preferredUnitSystem: 'metric' as const };
    mockedApi.fetchProfile
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(profile);
    mockedApi.fetchHousehold
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ id: 'household-1', starterRecipesSeededAt: null });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe(false);
    expect(result.current.household).toEqual({ id: 'household-1', starterRecipesSeededAt: null });
    expect(result.current.profile).toEqual(profile);
    expect(mockedApi.fetchProfile).toHaveBeenCalledTimes(2);
  });

  // Without this the retry would hide the only evidence of why the first
  // attempt failed, which is the open question the retry does not answer.
  it('still reports a failed attempt that a retry then recovers from', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockRejectedValueOnce(new Error('network down')).mockResolvedValue(null);
    mockedApi.fetchHousehold
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(null);

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe(false);
    expect(mockedLogError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: 'householdLoadRetry' }),
    );
  });

  it('setDisplayName creates the profile and refreshes state', async () => {
    mockedApi.fetchProfile.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold.mockResolvedValue(null);
    mockedApi.createProfile.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.setDisplayName('Alice');
    });

    expect(mockedApi.createProfile).toHaveBeenCalledWith('user-1', 'Alice');
    expect(outcome).toEqual({ error: null });
    await waitFor(() =>
      expect(result.current.profile).toEqual({
        id: 'user-1',
        displayName: 'Alice',
        preferredUnitSystem: 'us_customary',
      }),
    );
  });

  it('setDisplayName surfaces an error without throwing', async () => {
    mockedApi.fetchProfile.mockResolvedValue(null);
    mockedApi.fetchHousehold.mockResolvedValue(null);
    mockedApi.createProfile.mockRejectedValue(new Error('display name already taken'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.setDisplayName('Alice');
    });

    expect(outcome).toEqual({ error: 'display name already taken' });
  });

  it('createHousehold creates a household and refreshes state', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'household-1', starterRecipesSeededAt: null });
    mockedApi.createHousehold.mockResolvedValue({
      id: 'household-1',
      starterRecipesSeededAt: null,
    });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createHousehold();
    });

    await waitFor(() =>
      expect(result.current.household).toEqual({ id: 'household-1', starterRecipesSeededAt: null }),
    );
  });

  it('acceptInvitation accepts the invitation and refreshes state', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'household-1', starterRecipesSeededAt: null });
    mockedApi.acceptInvitation.mockResolvedValue({
      id: 'household-1',
      starterRecipesSeededAt: null,
    });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptInvitation('raw-token');
    });

    expect(mockedApi.acceptInvitation).toHaveBeenCalledWith('raw-token');
    await waitFor(() =>
      expect(result.current.household).toEqual({ id: 'household-1', starterRecipesSeededAt: null }),
    );
  });

  // T7/T8 of the invitation state table (#157). The distinction these
  // pin is the one that stranded a real invitee on 2026-09-01: a failure
  // *after* the membership row was written must not read as a failure to
  // join, and a transport failure must not spend the token.
  it('reports a transient accept failure as retryable, leaving the token spendable', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold.mockResolvedValue(null);
    mockedApi.acceptInvitation.mockRejectedValue({ code: '401', message: 'JWT expired' });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.acceptInvitation('raw-token');
    });

    expect(outcome).toEqual({
      outcome: 'retryable',
      message: expect.stringContaining('still saved'),
    });
  });

  // A stalled request is not a rejected one: fetch on React Native never
  // settles it, so before this bound the invitee sat on "Joining your
  // household…" until they force-quit. Found in review of #157.
  it('turns a stalled accept into a retryable outcome instead of hanging', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold.mockResolvedValue(null);
    // Never settles, in either direction.
    mockedApi.acceptInvitation.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      const pending = result.current.acceptInvitation('raw-token');
      jest.advanceTimersByTime(10_000);
      outcome = await pending;
    });

    expect(outcome).toEqual({
      outcome: 'retryable',
      message: expect.stringContaining('still saved'),
    });
  });

  it('gives up on a stalled initial load rather than holding the splash', async () => {
    jest.useFakeTimers();
    mockedApi.fetchProfile.mockReturnValue(new Promise(() => {}));
    mockedApi.fetchHousehold.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    // Past LOAD_TIMEOUT_MS, not RETRY_BUDGET_MS: what is being waited on
    // here is the 10s bound firing, not the 300ms+900ms retry chain.
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 15_000 });
    expect(result.current.loadError).toBe(true);
  });

  it('reports an RPC rejection as terminal', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold.mockResolvedValue(null);
    mockedApi.acceptInvitation.mockRejectedValue({
      code: 'P0001',
      message: 'invitation has expired',
    });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.acceptInvitation('raw-token');
    });

    expect(outcome).toEqual({
      outcome: 'terminal',
      message: expect.stringContaining('expired'),
    });
  });

  // Real timers deliberately: the refresh's 300ms+900ms retry chain is
  // awaited inside act(), and act() does not advance fake timers the way
  // waitFor does — under fake timers this hangs rather than failing.
  it('does not report a joined invitee as having failed when only the refresh fails', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    // Loads fine, then every refetch afterwards fails.
    mockedApi.fetchHousehold.mockResolvedValueOnce(null).mockRejectedValue(new Error('offline'));
    mockedApi.acceptInvitation.mockResolvedValue({
      id: 'household-1',
      starterRecipesSeededAt: null,
    });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.acceptInvitation('raw-token');
    });

    // The membership row exists. Saying "failed to accept invitation"
    // here is what sent a real invitee back to "Create a household".
    expect(outcome).toEqual({
      outcome: 'joined-refresh-failed',
      message: expect.stringContaining("You're in"),
    });
  });

  it('re-enters loading synchronously when the signed-in user changes', async () => {
    mockedUseSession.mockReturnValue({ session: null });
    mockedApi.fetchProfile.mockResolvedValue(null);
    mockedApi.fetchHousehold.mockResolvedValue(null);

    const { result, rerender } = await renderHook(() => useHousehold(), {
      wrapper: HouseholdProvider,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.household).toBeNull();

    // Simulates SessionProvider resolving from no session to a real one:
    // isLoading must flip back to true as soon as userId changes, driven
    // by the render itself rather than the fetch below — proven by
    // fetchHousehold never resolving here, so isLoading has no other way
    // to become true. Without this, a consumer (AuthenticatedRouteBoundary)
    // reading context in the gap before the fetch completes would see
    // isLoading=false with the previous user's (null) household and
    // misread it as "no household, fully loaded".
    mockedApi.fetchHousehold.mockReturnValue(new Promise(() => {}));
    mockedUseSession.mockReturnValue({ session: { user: { id: 'user-2' } } });
    rerender({});

    await waitFor(() => expect(result.current.isLoading).toBe(true));
  });

  it('throws when used outside a HouseholdProvider', async () => {
    await expect(renderHook(() => useHousehold())).rejects.toThrow(
      'useHousehold must be used within a HouseholdProvider',
    );
  });
});
