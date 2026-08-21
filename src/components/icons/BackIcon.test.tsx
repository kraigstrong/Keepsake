import { render } from '@testing-library/react-native';

import { BackIcon } from './BackIcon';

describe('BackIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<BackIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
