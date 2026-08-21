import { render } from '@testing-library/react-native';

import { CheckIcon } from './CheckIcon';

describe('CheckIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<CheckIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
