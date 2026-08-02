import { fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders with an accessible alert role', async () => {
    await render(<ErrorState title="Couldn't load recipes" />);
    expect(screen.getByRole('alert')).toBeOnTheScreen();
  });

  it('renders the message when given', async () => {
    await render(<ErrorState title="Couldn't load recipes" message="Check your connection." />);
    expect(screen.getByText('Check your connection.')).toBeOnTheScreen();
  });

  it('omits the retry button when no retry handler is given', async () => {
    await render(<ErrorState title="Couldn't load recipes" />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('renders and wires the retry button when given', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState title="Couldn't load recipes" onRetry={onRetry} />);

    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(
      <ErrorState title="Couldn't load recipes" message="Check your connection." />,
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
