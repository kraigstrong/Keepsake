import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title', async () => {
    await render(<EmptyState title="Nothing planned yet" />);
    expect(screen.getByText('Nothing planned yet')).toBeOnTheScreen();
  });

  it('renders the message when given', async () => {
    await render(<EmptyState title="Nothing planned yet" message="Add a recipe to get started." />);
    expect(screen.getByText('Add a recipe to get started.')).toBeOnTheScreen();
  });

  it('omits the action button when no action is given', async () => {
    await render(<EmptyState title="Nothing planned yet" />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('renders and wires the action button when given', async () => {
    const onAction = jest.fn();
    await render(
      <EmptyState title="Nothing planned yet" actionLabel="Add recipe" onAction={onAction} />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Add recipe' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(
      <EmptyState title="Nothing planned yet" message="Add a recipe to get started." />,
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
