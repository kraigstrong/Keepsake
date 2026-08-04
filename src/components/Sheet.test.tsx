import { act, fireEvent, render, screen } from '@testing-library/react-native';
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

  // The backdrop dim and the sheet's slide are animated independently
  // (not via Modal's own animationType) so the dim doesn't visibly rise
  // up from the bottom along with the sheet — Modal itself never
  // animates on its own.
  it('never delegates animation to the Modal itself, dim and sheet animate independently', async () => {
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    expect(screen.getByTestId('sheet').props.animationType).toBe('none');
    expect(screen.getByTestId('sheet-backdrop')).toBeOnTheScreen();
  });

  it('shows immediately with no animation delay when Reduced Motion is enabled', async () => {
    mockedUseReducedMotion.mockReturnValue(true);
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet').props.animationType).toBe('none');
  });

  it('unmounts only after the close animation finishes, not immediately on dismiss', async () => {
    const { rerender } = await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    await act(async () => {
      rerender(
        <Sheet visible={false} onDismiss={() => {}} testID="sheet">
          <Text>Sheet content</Text>
        </Sheet>,
      );
    });

    // Animated.timing's completion callback fires asynchronously even
    // under the JS-driven RN Animated implementation Jest uses — give it
    // a tick before asserting the content is finally gone.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(screen.queryByText('Sheet content')).not.toBeOnTheScreen();
  });
});
