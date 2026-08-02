import { render, screen } from '@testing-library/react-native';

import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('renders with an accessible progressbar role', async () => {
    await render(<LoadingState />);
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  });

  it('renders the label when given', async () => {
    await render(<LoadingState label="Loading recipes…" />);
    expect(screen.getByText('Loading recipes…')).toBeOnTheScreen();
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<LoadingState label="Loading recipes…" />);
    expect(toJSON()).toMatchSnapshot();
  });
});
