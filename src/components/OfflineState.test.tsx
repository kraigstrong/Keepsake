import { render, screen } from '@testing-library/react-native';

import { OfflineState } from './OfflineState';

describe('OfflineState', () => {
  it('renders a default message with an accessible status role', async () => {
    await render(<OfflineState />);
    expect(screen.getByRole('status')).toBeOnTheScreen();
    expect(screen.getByText("You're offline. Some features need a connection.")).toBeOnTheScreen();
  });

  it('renders a custom message when given', async () => {
    await render(<OfflineState message="Grocery export needs a connection." />);
    expect(screen.getByText('Grocery export needs a connection.')).toBeOnTheScreen();
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<OfflineState />);
    expect(toJSON()).toMatchSnapshot();
  });
});
