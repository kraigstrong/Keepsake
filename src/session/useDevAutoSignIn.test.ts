import { act, renderHook } from '@testing-library/react-native';

import { useDevAutoSignIn } from './useDevAutoSignIn';
import { useSession } from './SessionProvider';

jest.mock('./SessionProvider', () => ({ useSession: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn() }));

const mockedUseSession = useSession as jest.Mock;
const devGlobal = global as typeof global & { __DEV__: boolean };

const originalDev = devGlobal.__DEV__;
const originalEmail = process.env.EXPO_PUBLIC_DEV_TEST_EMAIL;
const originalPassword = process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD;

afterEach(() => {
  devGlobal.__DEV__ = originalDev;
  process.env.EXPO_PUBLIC_DEV_TEST_EMAIL = originalEmail;
  process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD = originalPassword;
  jest.clearAllMocks();
});

describe('useDevAutoSignIn', () => {
  it('signs in automatically in __DEV__ with both env vars set and no session yet', async () => {
    devGlobal.__DEV__ = true;
    process.env.EXPO_PUBLIC_DEV_TEST_EMAIL = 'dev-test@keepsake.local';
    process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD = 'secret123';
    const signInWithPassword = jest.fn().mockResolvedValue({ error: null });
    mockedUseSession.mockReturnValue({ session: null, isLoading: false, signInWithPassword });

    await act(async () => {
      renderHook(() => useDevAutoSignIn());
    });

    expect(signInWithPassword).toHaveBeenCalledWith('dev-test@keepsake.local', 'secret123');
  });

  it('does nothing outside __DEV__, even with both env vars set', () => {
    devGlobal.__DEV__ = false;
    process.env.EXPO_PUBLIC_DEV_TEST_EMAIL = 'dev-test@keepsake.local';
    process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD = 'secret123';
    const signInWithPassword = jest.fn();
    mockedUseSession.mockReturnValue({ session: null, isLoading: false, signInWithPassword });

    renderHook(() => useDevAutoSignIn());

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('does nothing when the env vars are unset, even in __DEV__', () => {
    devGlobal.__DEV__ = true;
    delete process.env.EXPO_PUBLIC_DEV_TEST_EMAIL;
    delete process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD;
    const signInWithPassword = jest.fn();
    mockedUseSession.mockReturnValue({ session: null, isLoading: false, signInWithPassword });

    renderHook(() => useDevAutoSignIn());

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('does not sign in again once a session already exists', () => {
    devGlobal.__DEV__ = true;
    process.env.EXPO_PUBLIC_DEV_TEST_EMAIL = 'dev-test@keepsake.local';
    process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD = 'secret123';
    const signInWithPassword = jest.fn();
    mockedUseSession.mockReturnValue({
      session: { user: { id: 'u1' } },
      isLoading: false,
      signInWithPassword,
    });

    renderHook(() => useDevAutoSignIn());

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('waits for session loading to finish before attempting sign-in', () => {
    devGlobal.__DEV__ = true;
    process.env.EXPO_PUBLIC_DEV_TEST_EMAIL = 'dev-test@keepsake.local';
    process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD = 'secret123';
    const signInWithPassword = jest.fn();
    mockedUseSession.mockReturnValue({ session: null, isLoading: true, signInWithPassword });

    renderHook(() => useDevAutoSignIn());

    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
