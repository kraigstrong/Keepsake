import { render, screen } from '@testing-library/react-native';

import { StartupScreen } from './StartupScreen';
import { useReducedMotion } from '../accessibility/useReducedMotion';

jest.mock('../accessibility/useReducedMotion');

const mockedUseReducedMotion = useReducedMotion as jest.Mock;

afterEach(() => jest.clearAllMocks());

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
});
