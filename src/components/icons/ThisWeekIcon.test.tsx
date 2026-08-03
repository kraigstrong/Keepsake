import { render } from '@testing-library/react-native';

import { ThisWeekIcon } from './ThisWeekIcon';

describe('ThisWeekIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<ThisWeekIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
