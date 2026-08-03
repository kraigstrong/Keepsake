import { render } from '@testing-library/react-native';

import { LibraryIcon } from './LibraryIcon';

describe('LibraryIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<LibraryIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
