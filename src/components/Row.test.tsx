import { fireEvent, render, screen } from '@testing-library/react-native';

import { Row } from './Row';

describe('Row', () => {
  it('renders as plain, non-interactive content when there is no onPress', async () => {
    await render(<Row title="Garlic Bread" />);
    expect(screen.getByText('Garlic Bread')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('renders with an accessible button role when onPress is given', async () => {
    await render(<Row title="Garlic Bread" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Garlic Bread' })).toBeOnTheScreen();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<Row title="Garlic Bread" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Garlic Bread' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not disable Dynamic Type font scaling on its title', async () => {
    await render(<Row title="Garlic Bread" />);
    expect(screen.getByText('Garlic Bread').props.allowFontScaling).not.toBe(false);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<Row title="Garlic Bread" onPress={() => {}} />);
    expect(toJSON()).toMatchSnapshot();
  });
});
