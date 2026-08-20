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

  it('calls onPressIn on touch-down when provided', async () => {
    const onPressIn = jest.fn();
    await render(<Button title="Save" onPress={() => {}} onPressIn={onPressIn} />);

    await fireEvent(screen.getByRole('button', { name: 'Save' }), 'pressIn');

    expect(onPressIn).toHaveBeenCalledTimes(1);
  });

  it('does not call onPressIn when disabled', async () => {
    const onPressIn = jest.fn();
    await render(<Button title="Save" onPress={() => {}} onPressIn={onPressIn} disabled />);

    await fireEvent(screen.getByRole('button', { name: 'Save' }), 'pressIn');

    expect(onPressIn).not.toHaveBeenCalled();
  });

  it('does not disable Dynamic Type font scaling on its label', async () => {
    await render(<Button title="Save" onPress={() => {}} />);
    expect(screen.getByText('Save').props.allowFontScaling).not.toBe(false);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<Button title="Save" onPress={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
