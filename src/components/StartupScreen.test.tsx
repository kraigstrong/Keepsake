import { render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { StartupScreen } from './StartupScreen';
import { useReducedMotion } from '../accessibility/useReducedMotion';

jest.mock('../accessibility/useReducedMotion');

const mockedUseReducedMotion = useReducedMotion as jest.Mock;

afterEach(() => jest.restoreAllMocks());

describe('StartupScreen', () => {
  it('renders without crashing', async () => {
    mockedUseReducedMotion.mockReturnValue(false);

    await render(<StartupScreen />);

    expect(screen.getByTestId('startup-screen')).toBeOnTheScreen();
    expect(screen.getByText('Keepsake')).toBeOnTheScreen();
    expect(screen.getByText('Loading your library…')).toBeOnTheScreen();
  });

  it('renders without crashing when reduced motion is enabled', async () => {
    mockedUseReducedMotion.mockReturnValue(true);

    await render(<StartupScreen />);

    expect(screen.getByTestId('startup-screen')).toBeOnTheScreen();
  });

  it('stops and snaps the wordmark fade when reduced motion resolves true after mount', async () => {
    // useReducedMotion always starts false (the real OS preference resolves
    // asynchronously) — this reproduces that false-then-true transition and
    // asserts the in-flight fade is actively stopped and snapped, not just
    // that no *new* animation starts.
    const stopAnimation = jest.spyOn(Animated.Value.prototype, 'stopAnimation');
    const setValue = jest.spyOn(Animated.Value.prototype, 'setValue');
    mockedUseReducedMotion.mockReturnValue(false);

    const { rerender } = await render(<StartupScreen />);
    stopAnimation.mockClear();
    setValue.mockClear();
    mockedUseReducedMotion.mockReturnValue(true);
    await rerender(<StartupScreen />);

    expect(stopAnimation).toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith(1);
  });
});
