import { fireEvent, render, screen } from '@testing-library/react-native';

import { Chip } from './Chip';

describe('Chip', () => {
  it('renders with an accessible button role', async () => {
    await render(<Chip label="Smart" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Smart' })).toBeOnTheScreen();
  });

  it('reflects selected state via accessibilityState', async () => {
    await render(<Chip label="Smart" selected onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Smart', selected: true })).toBeOnTheScreen();
  });

  it('defaults to unselected', async () => {
    await render(<Chip label="Smart" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Smart', selected: false })).toBeOnTheScreen();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Smart" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Smart' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not disable Dynamic Type font scaling on its label', async () => {
    await render(<Chip label="Smart" onPress={() => {}} />);
    expect(screen.getByText('Smart').props.allowFontScaling).not.toBe(false);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<Chip label="Smart" onPress={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
