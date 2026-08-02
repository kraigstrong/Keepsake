import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from './useReducedMotion';

// Spies on jest-expo's own react-native mock rather than replacing the
// whole module — spreading jest.requireActual('react-native') bypasses
// jest-expo's native-module mocking wholesale and breaks unrelated things
// (TurboModuleRegistry lookups for modules that only exist in the real
// native binary, e.g. DevMenu).
const isReduceMotionEnabledSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');
const addEventListenerSpy = jest.spyOn(AccessibilityInfo, 'addEventListener');

afterEach(() => jest.clearAllMocks());

describe('useReducedMotion', () => {
  it('resolves to the current setting', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(true);
    addEventListenerSpy.mockReturnValue({ remove: jest.fn() } as never);

    const { result } = await renderHook(() => useReducedMotion());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('defaults to false before the setting resolves', async () => {
    isReduceMotionEnabledSpy.mockReturnValue(new Promise(() => {}));
    addEventListenerSpy.mockReturnValue({ remove: jest.fn() } as never);

    const { result } = await renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  it('updates when the setting changes', async () => {
    isReduceMotionEnabledSpy.mockResolvedValue(false);
    let changeHandler: ((value: boolean) => void) | undefined;
    addEventListenerSpy.mockImplementation(((_event: string, handler: (value: boolean) => void) => {
      changeHandler = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(false));

    await act(async () => changeHandler?.(true));
    await waitFor(() => expect(result.current).toBe(true));
  });
});
