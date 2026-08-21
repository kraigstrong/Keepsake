import { render } from '@testing-library/react-native';

import { ChevronIcon } from './ChevronIcon';

describe('ChevronIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<ChevronIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
