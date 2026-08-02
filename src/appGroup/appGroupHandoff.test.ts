import AppGroupBridge from '../../modules/app-group-bridge/src/AppGroupBridgeModule';
import { isAppGroupContainerAvailable, readTestPayload, writeTestPayload } from './appGroupHandoff';

jest.mock('../../modules/app-group-bridge/src/AppGroupBridgeModule', () => ({
  containerAvailable: jest.fn(),
  writeTestPayload: jest.fn(),
  readTestPayload: jest.fn(),
}));

const mocked = AppGroupBridge as jest.Mocked<typeof AppGroupBridge>;

afterEach(() => jest.clearAllMocks());

describe('isAppGroupContainerAvailable', () => {
  it('reflects whether the shared container resolves', () => {
    mocked.containerAvailable.mockReturnValue(true);
    expect(isAppGroupContainerAvailable()).toBe(true);
  });
});

describe('writeTestPayload / readTestPayload', () => {
  it('round-trips through the native bridge', () => {
    mocked.writeTestPayload.mockReturnValue(true);
    mocked.readTestPayload.mockReturnValue('hello');

    expect(writeTestPayload('hello')).toBe(true);
    expect(readTestPayload()).toBe('hello');
    expect(mocked.writeTestPayload).toHaveBeenCalledWith('hello');
  });

  it('surfaces a null read when nothing has been written', () => {
    mocked.readTestPayload.mockReturnValue(null);
    expect(readTestPayload()).toBeNull();
  });
});
