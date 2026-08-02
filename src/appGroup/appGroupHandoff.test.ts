import AppGroupBridge from '../../modules/app-group-bridge/src/AppGroupBridgeModule';
import {
  clearSharedImport,
  isAppGroupContainerAvailable,
  readSharedImport,
  readTestPayload,
  writeTestPayload,
} from './appGroupHandoff';

jest.mock('../../modules/app-group-bridge/src/AppGroupBridgeModule', () => ({
  containerAvailable: jest.fn(),
  writeTestPayload: jest.fn(),
  readTestPayload: jest.fn(),
  readSharePayload: jest.fn(),
  clearSharePayload: jest.fn(),
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

describe('readSharedImport', () => {
  afterEach(() => jest.clearAllMocks());

  it('parses a well-formed payload from the Share Extension', () => {
    mocked.readSharePayload.mockReturnValue(
      '{"url":"https://example.com/recipe","receivedAt":1785600000000}',
    );
    expect(readSharedImport()).toEqual({
      url: 'https://example.com/recipe',
      receivedAt: 1785600000000,
    });
  });

  it('returns null when nothing has been shared yet', () => {
    mocked.readSharePayload.mockReturnValue(null);
    expect(readSharedImport()).toBeNull();
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['missing url', '{"receivedAt":1785600000000}'],
    ['empty url', '{"url":"","receivedAt":1785600000000}'],
    ['non-string url', '{"url":123,"receivedAt":1785600000000}'],
    ['missing receivedAt', '{"url":"https://example.com"}'],
  ])('returns null for %s rather than throwing', (_label, raw) => {
    mocked.readSharePayload.mockReturnValue(raw);
    expect(readSharedImport()).toBeNull();
  });
});

describe('clearSharedImport', () => {
  it('delegates to the native bridge', () => {
    mocked.clearSharePayload.mockReturnValue(true);
    expect(clearSharedImport()).toBe(true);
  });
});
