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

  it('omits the secondary action unless both label and handler are given', async () => {
    await render(
      <EmptyState title="Nothing planned yet" actionLabel="Add recipe" onAction={jest.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Start with my own' })).not.toBeOnTheScreen();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders and wires the secondary action when given', async () => {
    const onAction = jest.fn();
    const onSecondaryAction = jest.fn();
    await render(
      <EmptyState
        title="Start your Keepsake"
        actionLabel="Add starter recipes"
        onAction={onAction}
        secondaryActionLabel="Start with my own"
        onSecondaryAction={onSecondaryAction}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Start with my own' }));

    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('disables only the primary action, leaving the secondary usable', async () => {
    // The point of the disabled state is "this is working", so the way
    // out of the screen must not be disabled along with it.
    const onAction = jest.fn();
    const onSecondaryAction = jest.fn();
    await render(
      <EmptyState
        title="Start your Keepsake"
        actionLabel="Adding recipes…"
        onAction={onAction}
        actionDisabled
        secondaryActionLabel="Start with my own"
        onSecondaryAction={onSecondaryAction}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Adding recipes…' }));
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Start with my own' }));
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it('renders an inline error message when given, and nothing when not', async () => {
    const { rerender } = await render(<EmptyState title="Start your Keepsake" />);
    expect(screen.queryByText('Something went wrong.')).not.toBeOnTheScreen();

    await rerender(<EmptyState title="Start your Keepsake" errorMessage="Something went wrong." />);
    expect(screen.getByText('Something went wrong.')).toBeOnTheScreen();
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(
      <EmptyState title="Nothing planned yet" message="Add a recipe to get started." />,
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
