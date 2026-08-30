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
    mockedApi.fetchHousehold.mockResolvedValue({ id: 'household-1' });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toEqual({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    expect(result.current.household).toEqual({ id: 'household-1' });
  });

  it('does not fetch when there is no session', async () => {
    mockedUseSession.mockReturnValue({ session: null });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.household).toBeNull();
    expect(mockedApi.fetchProfile).not.toHaveBeenCalled();
  });

  // The initial load used to have no .catch(), so any rejection left
  // isLoading true forever — StartupScreen with no error, no retry and
  // nothing logged (developer cold launch, 2026-08-30).
  it('a failed initial load stops loading and reports an error instead of hanging', async () => {
    mockedApi.fetchProfile.mockRejectedValue(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadError).toBe(true);
    expect(mockedLogError).toHaveBeenCalled();
  });

  // The reason loadError exists at all rather than just clearing isLoading:
  // household stays null on failure, and a null household is what routes to
  // onboarding's irreversible "Create a household" button.
  it('a failed initial load does not report the user as having no household', async () => {
    mockedApi.fetchProfile.mockRejectedValue(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // household is null either way — loadError is the only thing that
    // distinguishes "we don't know" from "they genuinely have none".
    expect(result.current.household).toBeNull();
    expect(result.current.loadError).toBe(true);
  });

  it('retryLoad clears the error and recovers when the fetch succeeds', async () => {
    mockedApi.fetchProfile.mockRejectedValueOnce(new Error('network down'));
    mockedApi.fetchHousehold.mockRejectedValueOnce(new Error('network down'));

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.loadError).toBe(true));

    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'metric',
    });
    mockedApi.fetchHousehold.mockResolvedValue({ id: 'household-1' });

    await act(async () => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(result.current.loadError).toBe(false));
    expect(result.current.household).toEqual({ id: 'household-1' });
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
      .mockResolvedValueOnce({ id: 'household-1' });
    mockedApi.createHousehold.mockResolvedValue({ id: 'household-1' });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createHousehold();
    });

    await waitFor(() => expect(result.current.household).toEqual({ id: 'household-1' }));
  });

  it('acceptInvitation accepts the invitation and refreshes state', async () => {
    mockedApi.fetchProfile.mockResolvedValue({
      id: 'user-1',
      displayName: 'Alice',
      preferredUnitSystem: 'us_customary',
    });
    mockedApi.fetchHousehold
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'household-1' });
    mockedApi.acceptInvitation.mockResolvedValue({ id: 'household-1' });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptInvitation('raw-token');
    });

    expect(mockedApi.acceptInvitation).toHaveBeenCalledWith('raw-token');
    await waitFor(() => expect(result.current.household).toEqual({ id: 'household-1' }));
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
