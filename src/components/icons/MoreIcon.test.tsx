import { render } from '@testing-library/react-native';

import { MoreIcon } from './MoreIcon';

describe('MoreIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<MoreIcon color="#FFFFFF" />);
    expect(toJSON()).toBeTruthy();
  });
});
