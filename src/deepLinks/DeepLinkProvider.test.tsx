import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

import { DeepLinkProvider, useDeepLink } from './DeepLinkProvider';

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));

const mockedLinking = Linking as jest.Mocked<typeof Linking>;
const removeListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedLinking.getInitialURL.mockResolvedValue(null);
  mockedLinking.addEventListener.mockReturnValue({ remove: removeListener } as never);
});

describe('DeepLinkProvider / useDeepLink', () => {
  it('starts with no pending invitation when there is no initial URL', async () => {
    const { result } = await renderHook(() => useDeepLink(), { wrapper: DeepLinkProvider });

    await waitFor(() => expect(mockedLinking.getInitialURL).toHaveBeenCalled());
    expect(result.current.pendingInvitationToken).toBeNull();
  });

  it('extracts the token from a valid cold-start invitation URL', async () => {
    mockedLinking.getInitialURL.mockResolvedValue(
      'keepsake://invite/abcdefghijklmnopqrstuvwxyz012345',
    );

    const { result } = await renderHook(() => useDeepLink(), { wrapper: DeepLinkProvider });

    await waitFor(() =>
      expect(result.current.pendingInvitationToken).toBe('abcdefghijklmnopqrstuvwxyz012345'),
    );
  });

  it('ignores a malformed initial URL', async () => {
    mockedLinking.getInitialURL.mockResolvedValue('https://not-an-invite.example.test');

    const { result } = await renderHook(() => useDeepLink(), { wrapper: DeepLinkProvider });

    await waitFor(() => expect(mockedLinking.getInitialURL).toHaveBeenCalled());
    expect(result.current.pendingInvitationToken).toBeNull();
  });

  it('captures a token from a warm "url" event', async () => {
    let urlHandler: (event: { url: string }) => void = () => {};
    mockedLinking.addEventListener.mockImplementation((_event, handler) => {
      urlHandler = handler as (event: { url: string }) => void;
      return { remove: removeListener } as never;
    });

    const { result } = await renderHook(() => useDeepLink(), { wrapper: DeepLinkProvider });
    await waitFor(() => expect(mockedLinking.getInitialURL).toHaveBeenCalled());

    await act(async () =>
      urlHandler({ url: 'keepsake://invite/zyxwvutsrqponmlkjihgfedcba098765' }),
    );

    await waitFor(() =>
      expect(result.current.pendingInvitationToken).toBe('zyxwvutsrqponmlkjihgfedcba098765'),
    );
  });

  it('clearPendingInvitationToken resets the token to null', async () => {
    mockedLinking.getInitialURL.mockResolvedValue(
      'keepsake://invite/abcdefghijklmnopqrstuvwxyz012345',
    );

    const { result } = await renderHook(() => useDeepLink(), { wrapper: DeepLinkProvider });
    await waitFor(() => expect(result.current.pendingInvitationToken).not.toBeNull());

    await act(async () => result.current.clearPendingInvitationToken());

    expect(result.current.pendingInvitationToken).toBeNull();
  });

  it('removes the url event listener on unmount', async () => {
    const { result, unmount } = await renderHook(() => useDeepLink(), {
      wrapper: DeepLinkProvider,
    });
    await waitFor(() => expect(result.current).toBeTruthy());

    await act(async () => unmount());

    expect(removeListener).toHaveBeenCalled();
  });

  it('throws when used outside a DeepLinkProvider', async () => {
    await expect(renderHook(() => useDeepLink())).rejects.toThrow(
      'useDeepLink must be used within a DeepLinkProvider',
    );
  });
});
