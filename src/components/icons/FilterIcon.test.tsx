import { render } from '@testing-library/react-native';

import { FilterIcon } from './FilterIcon';

describe('FilterIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<FilterIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
