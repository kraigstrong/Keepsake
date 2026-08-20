import { render } from '@testing-library/react-native';

import { KeepsakeMark } from './KeepsakeMark';

describe('KeepsakeMark', () => {
  it('renders without crashing', async () => {
    const { toJSON } = await render(<KeepsakeMark color="#F7F3EC" />);
    expect(toJSON()).toBeTruthy();
  });
});
