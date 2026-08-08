import { render } from '@testing-library/react-native';

import { PlusIcon } from './PlusIcon';

describe('PlusIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<PlusIcon color="#FFFFFF" />);
    expect(toJSON()).toBeTruthy();
  });
});
