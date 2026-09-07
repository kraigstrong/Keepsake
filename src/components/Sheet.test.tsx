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
  // animates on its own. The actual open animation is driven from
  // Modal's onShow, a native-only event Jest has no way to fire — real
  // verification of the animation itself has to happen on a device or
  // Simulator, not here. What's testable and tested below: the
  // structural pieces (backdrop is separate from the sheet content,
  // animationType is always 'none') and the state-machine logic that's
  // ours to control (visible mirrors straight through to Modal, and
  // progress resets on close so a second open has something to animate
  // from — see ADR discussion / commit history for the real-device bug
  // this reset fixes).
  it('never delegates animation to the Modal itself, dim and sheet animate independently', async () => {
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    expect(screen.getByTestId('sheet').props.animationType).toBe('none');
    expect(screen.getByTestId('sheet-backdrop')).toBeOnTheScreen();
  });

  // The grabber's actual drag-to-dismiss physics (PanGestureHandler
  // translationY/velocityY driving a real native pan) aren't exercised
  // here, the same way the open/close slide animation above isn't —
  // this project has no react-native-gesture-handler jest native-event
  // mock wired up, and fireGestureHandler needs one. What's testable and
  // tested: the grabber renders as its own element wherever a Sheet
  // does, so the affordance itself (developer UX feedback: "I'd expect
  // to be able to pull that filter pop-up down") is present. The actual
  // gesture needs a device/Simulator pass.
  it('renders a drag handle above the sheet content', async () => {
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    expect(screen.getByTestId('sheet-grabber')).toBeOnTheScreen();
  });

  it('shows immediately when Reduced Motion is enabled', async () => {
    mockedUseReducedMotion.mockReturnValue(true);
    await render(
      <Sheet visible onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet').props.animationType).toBe('none');
  });

  it('opens when visible flips from false to true after the initial render', async () => {
    const { rerender } = await render(
      <Sheet visible={false} onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Sheet content')).not.toBeOnTheScreen();

    await act(async () => {
      rerender(
        <Sheet visible onDismiss={() => {}} testID="sheet">
          <Text>Sheet content</Text>
        </Sheet>,
      );
    });

    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
  });

  // Real-device bug: the first open animated correctly, but a second
  // open after closing once just snapped straight to the fully-open
  // state — progress was left at its "open" value (1) by the first
  // animation, so the second open's Animated.timing(toValue: 1) had
  // nothing left to animate. Fixed by resetting progress to 0 as soon
  // as `visible` goes false, so it always starts from 0 again.
  it('mirrors Modal visibility through open -> close -> open without erroring', async () => {
    const { rerender } = await render(
      <Sheet visible={false} onDismiss={() => {}} testID="sheet">
        <Text>Sheet content</Text>
      </Sheet>,
    );

    await act(async () => {
      rerender(
        <Sheet visible onDismiss={() => {}} testID="sheet">
          <Text>Sheet content</Text>
        </Sheet>,
      );
    });
    expect(screen.getByText('Sheet content')).toBeOnTheScreen();

    await act(async () => {
      rerender(
        <Sheet visible={false} onDismiss={() => {}} testID="sheet">
          <Text>Sheet content</Text>
        </Sheet>,
      );
    });
    expect(screen.queryByText('Sheet content')).not.toBeOnTheScreen();

    await act(async () => {
      rerender(
        <Sheet visible onDismiss={() => {}} testID="sheet">
          <Text>Sheet content</Text>
        </Sheet>,
      );
    });
    expect(screen.getByText('Sheet content')).toBeOnTheScreen();
  });
});
