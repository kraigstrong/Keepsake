import { renderHook } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { useCookingModeAwake } from './useCookingModeAwake';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

describe('useCookingModeAwake', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('activates keep-awake with a stable tag on mount', async () => {
    await renderHook(() => useCookingModeAwake());

    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('cooking-mode');
  });

  it('deactivates the same tag on unmount, never a different one', async () => {
    const { unmount } = await renderHook(() => useCookingModeAwake());
    unmount();

    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(deactivateKeepAwake).toHaveBeenCalledWith('cooking-mode');
  });
});
