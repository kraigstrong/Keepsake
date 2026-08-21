import { render } from '@testing-library/react-native';

import { CloseIcon } from './CloseIcon';

describe('CloseIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<CloseIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
