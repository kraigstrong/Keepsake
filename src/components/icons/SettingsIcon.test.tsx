import { render } from '@testing-library/react-native';

import { SettingsIcon } from './SettingsIcon';

describe('SettingsIcon', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<SettingsIcon color="#211D18" />);
    expect(toJSON()).toBeTruthy();
  });
});
