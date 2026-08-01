import { render } from '@testing-library/react-native';

import App from './App';

describe('App', () => {
  it('renders the Phase 0 placeholder screen', async () => {
    const { getByText } = await render(<App />);

    expect(getByText(/Keepsake/)).toBeTruthy();
  });
});
