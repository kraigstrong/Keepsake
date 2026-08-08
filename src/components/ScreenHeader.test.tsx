import { render, screen } from '@testing-library/react-native';

import { ScreenHeader } from './ScreenHeader';

describe('ScreenHeader', () => {
  it('renders the title and a Settings link', async () => {
    await render(<ScreenHeader title="This Week" />);

    expect(screen.getByText('This Week')).toBeOnTheScreen();
    expect(screen.getByLabelText('Settings')).toBeOnTheScreen();
  });
});
