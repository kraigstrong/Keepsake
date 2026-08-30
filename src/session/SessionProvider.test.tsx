import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { SessionProvider, useSession } from './SessionProvider';
import { supabase } from '../supabase/instance';
import { wipeOfflineData } from '../sync/wipeOfflineData';

jest.mock('../supabase/instance', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      updateUser: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
  },
}));
jest.mock('../sync/wipeOfflineData', () => ({ wipeOfflineData: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn() }));

const mockedAuth = supabase.auth as jest.Mocked<typeof supabase.auth>;
const mockedWipeOfflineData = wipeOfflineData as jest.Mock;

const fakeSession = { user: { id: 'user-123' } } as unknown as Session;

// Captures the callback SessionProvider hands to onAuthStateChange, so
// tests can fire it manually to simulate what supabase-js does internally
// after a real sign-in/sign-out/token-refresh.
let authStateCallback: (event: AuthChangeEvent, session: Session | null) => void;
const unsubscribe = jest.fn();

// Same capture pattern for the AppState listener SessionProvider registers
// to drive supabase-js's auto-refresh timer from foreground/background
// transitions (the timer alone isn't reliable while backgrounded on
// mobile — see the comment in SessionProvider.tsx).
const addEventListenerSpy = jest.spyOn(AppState, 'addEventListener');
let appStateHandler: (state: string) => void;
const removeAppStateListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedAuth.getSession.mockResolvedValue({ data: { session: null }, error: null } as never);
  mockedAuth.onAuthStateChange.mockImplementation((callback) => {
    authStateCallback = callback;
    return { data: { subscription: { unsubscribe } } } as never;
  });
  addEventListenerSpy.mockImplementation((_event, handler) => {
    appStateHandler = handler as (state: string) => void;
    return { remove: removeAppStateListener } as never;
  });
  mockedWipeOfflineData.mockResolvedValue(undefined);
});

describe('SessionProvider / useSession', () => {
  it('a rejected getSession stops loading instead of hanging the splash', async () => {
    mockedAuth.getSession.mockRejectedValue(new Error('keychain unavailable'));

    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('resolves to null when there is no existing Supabase session', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('resolves to the existing Supabase session', async () => {
    mockedAuth.getSession.mockResolvedValue({
      data: { session: fakeSession },
      error: null,
    } as never);

    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.session).toEqual(fakeSession);
  });

  it('updates session when onAuthStateChange fires', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => authStateCallback('SIGNED_IN', fakeSession));

    await waitFor(() => expect(result.current.session).toEqual(fakeSession));
  });

  it('sendOtp calls signInWithOtp and reports no error on success', async () => {
    mockedAuth.signInWithOtp.mockResolvedValue({ data: {}, error: null } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.sendOtp('user@example.test');
    });

    expect(mockedAuth.signInWithOtp).toHaveBeenCalledWith({ email: 'user@example.test' });
    expect(outcome).toEqual({ error: null });
  });

  it('sendOtp surfaces the Supabase error message', async () => {
    mockedAuth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: 'rate limited' },
    } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.sendOtp('user@example.test');
    });

    expect(outcome).toEqual({ error: 'rate limited' });
  });

  it('verifyOtp calls verifyOtp with the email code as an email-type OTP', async () => {
    mockedAuth.verifyOtp.mockResolvedValue({ data: {}, error: null } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.verifyOtp('user@example.test', '123456');
    });

    expect(mockedAuth.verifyOtp).toHaveBeenCalledWith({
      email: 'user@example.test',
      token: '123456',
      type: 'email',
    });
    expect(outcome).toEqual({ error: null });
  });

  it('setPassword calls updateUser and reports no error on success', async () => {
    mockedAuth.updateUser.mockResolvedValue({ data: {}, error: null } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.setPassword('correct-horse-battery');
    });

    expect(mockedAuth.updateUser).toHaveBeenCalledWith({ password: 'correct-horse-battery' });
    expect(outcome).toEqual({ error: null });
  });

  it('setPassword surfaces the Supabase error message', async () => {
    mockedAuth.updateUser.mockResolvedValue({
      data: {},
      error: { message: 'Password should be at least 8 characters' },
    } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.setPassword('short');
    });

    expect(outcome).toEqual({ error: 'Password should be at least 8 characters' });
  });

  it('signInWithPassword calls signInWithPassword and reports no error on success', async () => {
    mockedAuth.signInWithPassword.mockResolvedValue({ data: {}, error: null } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithPassword(
        'user@example.test',
        'correct-horse-battery',
      );
    });

    expect(mockedAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'user@example.test',
      password: 'correct-horse-battery',
    });
    expect(outcome).toEqual({ error: null });
  });

  it('signInWithPassword surfaces the Supabase error message', async () => {
    mockedAuth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: { error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.signInWithPassword('user@example.test', 'wrong');
    });

    expect(outcome).toEqual({ error: 'Invalid login credentials' });
  });

  it('signOut calls supabase.auth.signOut and wipes the local offline cache', async () => {
    mockedAuth.signOut.mockResolvedValue({ error: null } as never);
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockedAuth.signOut).toHaveBeenCalled();
    expect(mockedWipeOfflineData).toHaveBeenCalled();
  });

  it('signOut does not throw when the cache wipe fails', async () => {
    mockedAuth.signOut.mockResolvedValue({ error: null } as never);
    mockedWipeOfflineData.mockRejectedValue(new Error('disk error'));
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.signOut();
      }),
    ).resolves.toBeUndefined();
  });

  it('unsubscribes from auth state changes and the AppState listener on unmount', async () => {
    const { result, unmount } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => unmount());

    expect(unsubscribe).toHaveBeenCalled();
    expect(removeAppStateListener).toHaveBeenCalled();
  });

  it('starts and stops auto-refresh as the app foregrounds and backgrounds', async () => {
    const { result } = await renderHook(() => useSession(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => appStateHandler('active'));
    expect(mockedAuth.startAutoRefresh).toHaveBeenCalled();

    await act(async () => appStateHandler('background'));
    expect(mockedAuth.stopAutoRefresh).toHaveBeenCalled();
  });

  it('throws when used outside a SessionProvider', async () => {
    await expect(renderHook(() => useSession())).rejects.toThrow(
      'useSession must be used within a SessionProvider',
    );
  });
});
