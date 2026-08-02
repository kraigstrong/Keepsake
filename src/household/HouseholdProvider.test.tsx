import { act, renderHook, waitFor } from '@testing-library/react-native';

import { HouseholdProvider, useHousehold } from './HouseholdProvider';
import * as api from './api';
import { useSession } from '../session/SessionProvider';

jest.mock('./api');
jest.mock('../session/SessionProvider', () => ({
  useSession: jest.fn(),
}));
// ./api is auto-mocked above, but Jest still loads the real module once to
// derive its shape — which would otherwise trip src/supabase/instance.ts's
// missing-env-var throw.
jest.mock('../supabase/instance', () => ({ supabase: {} }));

const mockedUseSession = useSession as jest.Mock;
const mockedApi = api as jest.Mocked<typeof api>;

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
    mockedApi.fetchProfile.mockResolvedValue({ id: 'user-1', displayName: 'Alice' });
    mockedApi.fetchHousehold.mockResolvedValue({ id: 'household-1' });

    const { result } = await renderHook(() => useHousehold(), { wrapper: HouseholdProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.profile).toEqual({ id: 'user-1', displayName: 'Alice' });
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

  it('setDisplayName creates the profile and refreshes state', async () => {
    mockedApi.fetchProfile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'user-1', displayName: 'Alice' });
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
      expect(result.current.profile).toEqual({ id: 'user-1', displayName: 'Alice' }),
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
    mockedApi.fetchProfile.mockResolvedValue({ id: 'user-1', displayName: 'Alice' });
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
    mockedApi.fetchProfile.mockResolvedValue({ id: 'user-1', displayName: 'Alice' });
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

  it('throws when used outside a HouseholdProvider', async () => {
    await expect(renderHook(() => useHousehold())).rejects.toThrow(
      'useHousehold must be used within a HouseholdProvider',
    );
  });
});
