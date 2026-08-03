import { act, renderHook } from '@testing-library/react-native';

import NetInfo from '@react-native-community/netinfo';
import { ConnectivityProvider, useConnectivity } from './ConnectivityProvider';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

const mockedAddEventListener = NetInfo.addEventListener as jest.Mock;

// act() must be awaited even for a synchronous callback — React 19's test
// renderer treats act() as always-async internally, and an un-awaited
// call leaves a dangling flush that bleeds into (and corrupts) whichever
// test runs next.
async function emit(state: { isConnected: boolean | null; isInternetReachable: boolean | null }) {
  const listener = mockedAddEventListener.mock.calls[0]?.[0];
  await act(async () => {
    listener?.(state);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAddEventListener.mockReturnValue(jest.fn());
});

describe('ConnectivityProvider / useConnectivity', () => {
  it('starts online before any NetInfo event arrives', async () => {
    const { result } = await renderHook(() => useConnectivity(), { wrapper: ConnectivityProvider });
    expect(result.current.isOnline).toBe(true);
  });

  it('goes offline when NetInfo reports no connection', async () => {
    const { result } = await renderHook(() => useConnectivity(), { wrapper: ConnectivityProvider });

    await emit({ isConnected: false, isInternetReachable: false });

    expect(result.current.isOnline).toBe(false);
  });

  it('treats a null isInternetReachable as online, not offline', async () => {
    const { result } = await renderHook(() => useConnectivity(), { wrapper: ConnectivityProvider });

    await emit({ isConnected: true, isInternetReachable: null });

    expect(result.current.isOnline).toBe(true);
  });

  it('calls onReconnect on the offline -> online transition, and only then', async () => {
    const onReconnect = jest.fn();
    await renderHook(() => useConnectivity(), {
      wrapper: ({ children }) => (
        <ConnectivityProvider onReconnect={onReconnect}>{children}</ConnectivityProvider>
      ),
    });

    await emit({ isConnected: false, isInternetReachable: false });
    expect(onReconnect).not.toHaveBeenCalled();

    await emit({ isConnected: true, isInternetReachable: true });
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Still online on the next event — not a new transition, no extra call.
    await emit({ isConnected: true, isInternetReachable: true });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside a ConnectivityProvider', async () => {
    await expect(renderHook(() => useConnectivity())).rejects.toThrow(
      'useConnectivity must be used within a ConnectivityProvider',
    );
  });
});
