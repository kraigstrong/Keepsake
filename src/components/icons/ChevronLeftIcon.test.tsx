import { render } from '@testing-library/react-native';

import { ChevronLeftIcon } from './ChevronLeftIcon';

describe('ChevronLeftIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<ChevronLeftIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
