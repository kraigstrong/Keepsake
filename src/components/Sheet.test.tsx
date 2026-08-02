import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useReducedMotion } from '../accessibility/useReducedMotion';
import { Sheet } from './Sheet';

jest.mock('../accessibility/useReducedMotion');

const mockedUseReducedMotion = useReducedMotion as jest.Mock;

beforeEach(() => mockedUseReducedMotion.mockReturnValue(false));
afterEach(() => jest.clearAllMocks());

describe('Sheet', () => {
  it('renders its children when visible', async () => {
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );
    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
  });

  it('does not render its children when not visible', async () => {
    await render(
      <Sheet visible={false} onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Sheet content')).not.toBeOnTheScreen();
  });

  it('calls onDismiss when the backdrop is pressed', async () => {
    const onDismiss = jest.fn();
    await render(
      <Sheet visible onDismiss={onDismiss} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    fireEvent.press(screen.getByLabelText('Dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses no animation when Reduced Motion is enabled', async () => {
    mockedUseReducedMotion.mockReturnValue(true);
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('sheet').props.animationType).toBe('none');
  });

  it('slides in when Reduced Motion is disabled', async () => {
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('sheet').props.animationType).toBe('slide');
  });
});
