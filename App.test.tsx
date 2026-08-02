import { render } from '@testing-library/react-native';

import App from './App';

// jest-expo auto-mocks native modules published by the Expo SDK, but this
// local module isn't in that registry — mock it directly, same as every
// other native dependency's own unit tests do.
jest.mock('./modules/app-group-bridge/src/AppGroupBridgeModule', () => ({
  containerAvailable: jest.fn(),
  writeTestPayload: jest.fn(),
  readTestPayload: jest.fn(),
}));

describe('App', () => {
  it('renders the Phase 0 placeholder screen', async () => {
    const { getByText } = await render(<App />);

    expect(getByText(/Keepsake/)).toBeTruthy();
  });
});
