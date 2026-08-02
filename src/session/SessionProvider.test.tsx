import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { SessionProvider, useSession } from './SessionProvider';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

afterEach(() => jest.clearAllMocks());

// renderHook (this @testing-library/react-native version) is async, same
// as render() — every call below is awaited.
describe('SessionProvider / useSession', () => {
  it('resolves to null when nothing is stored', async () => {
    mocked.getItemAsync.mockResolvedValue(null);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('resolves to the stored session', async () => {
    mocked.getItemAsync.mockResolvedValue('{"userId":"user-123"}');
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toEqual({ userId: 'user-123' });
  });

  it('signIn stores and reflects the new session', async () => {
    mocked.getItemAsync.mockResolvedValue(null);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signIn({ userId: 'user-456' });
    });

    expect(result.current.session).toEqual({ userId: 'user-456' });
    expect(mocked.setItemAsync).toHaveBeenCalledWith('keepsake-session', '{"userId":"user-456"}');
  });

  it('signOut clears the stored session', async () => {
    mocked.getItemAsync.mockResolvedValue('{"userId":"user-123"}');
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.session).toEqual({ userId: 'user-123' }));

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.session).toBeNull();
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith('keepsake-session');
  });

  it('throws when used outside a SessionProvider', async () => {
    await expect(renderHook(() => useSession())).rejects.toThrow(
      'useSession must be used within a SessionProvider',
    );
  });
});
