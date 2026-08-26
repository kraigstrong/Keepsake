import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from './Button';

describe('Button', () => {
  it('renders with an accessible button role', async () => {
    await render(<Button title="Save" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeOnTheScreen();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button title="Save" onPress={onPress} disabled />);

    fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('calls onTouchStart on touch-down when provided', async () => {
    const onTouchStart = jest.fn();
    await render(<Button title="Save" onPress={() => {}} onTouchStart={onTouchStart} />);

    await fireEvent(screen.getByRole('button', { name: 'Save' }), 'touchStart');

    expect(onTouchStart).toHaveBeenCalledTimes(1);
  });

  // Not tested: onTouchStart firing even when disabled. That's real
  // RN behavior (onTouchStart is a raw View prop, not Pressability-gated
  // — see ButtonProps.onTouchStart), but RTL's fireEvent simulates its
  // own, more conservative model that gates raw touch events on
  // Pressable's onStartShouldSetResponder() too, so it can't observe
  // that distinction. DoneCookingSheet's own isSubmitting check is the
  // real guard against this in production.

  it('does not disable Dynamic Type font scaling on its label', async () => {
    await render(<Button title="Save" onPress={() => {}} />);
    expect(screen.getByText('Save').props.allowFontScaling).not.toBe(false);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<Button title="Save" onPress={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });

  // outlineAccent (1a's "Help me choose" entry point): bordered rust,
  // deliberately not filled — distinct from both primary (filled rust)
  // and secondary (neutral hairline border).
  it('renders the outlineAccent variant with an accent border and label', async () => {
    await render(<Button title="Help me choose" onPress={() => {}} variant="outlineAccent" />);

    const button = screen.getByRole('button', { name: 'Help me choose' });
    expect(button.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: '#B5502E', borderWidth: 1 })]),
    );
  });
});
