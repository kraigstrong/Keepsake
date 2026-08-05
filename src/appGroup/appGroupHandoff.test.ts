import AppGroupBridge from '../../modules/app-group-bridge/src/AppGroupBridgeModule';
import {
  deleteQueuedShare,
  isAppGroupContainerAvailable,
  readQueuedShares,
  readTestPayload,
  writeTestPayload,
} from './appGroupHandoff';

jest.mock('../../modules/app-group-bridge/src/AppGroupBridgeModule', () => ({
  containerAvailable: jest.fn(),
  writeTestPayload: jest.fn(),
  readTestPayload: jest.fn(),
  listSharePayloads: jest.fn(),
  deleteSharePayload: jest.fn(),
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

describe('readQueuedShares', () => {
  it('parses every well-formed payload from the Share Extension queue', () => {
    mocked.listSharePayloads.mockReturnValue([
      '{"id":"11111111-1111-1111-1111-111111111111","url":"https://example.com/recipe","receivedAt":1785600000000}',
      '{"id":"22222222-2222-2222-2222-222222222222","url":"https://example.com/soup","receivedAt":1785600000001}',
    ]);

    expect(readQueuedShares()).toEqual([
      {
        id: '11111111-1111-1111-1111-111111111111',
        url: 'https://example.com/recipe',
        receivedAt: 1785600000000,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        url: 'https://example.com/soup',
        receivedAt: 1785600000001,
      },
    ]);
  });

  it('returns an empty array when the queue is empty', () => {
    mocked.listSharePayloads.mockReturnValue([]);
    expect(readQueuedShares()).toEqual([]);
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['missing id', '{"url":"https://example.com","receivedAt":1785600000000}'],
    ['empty id', '{"id":"","url":"https://example.com","receivedAt":1785600000000}'],
    ['missing url', '{"id":"1","receivedAt":1785600000000}'],
    ['empty url', '{"id":"1","url":"","receivedAt":1785600000000}'],
    ['non-string url', '{"id":"1","url":123,"receivedAt":1785600000000}'],
    ['missing receivedAt', '{"id":"1","url":"https://example.com"}'],
  ])('skips a malformed entry for %s rather than throwing', (_label, raw) => {
    mocked.listSharePayloads.mockReturnValue([raw]);
    expect(readQueuedShares()).toEqual([]);
  });

  it('skips only the malformed entries in a mixed batch, keeping the rest', () => {
    mocked.listSharePayloads.mockReturnValue([
      'not json',
      '{"id":"11111111-1111-1111-1111-111111111111","url":"https://example.com/recipe","receivedAt":1785600000000}',
    ]);

    expect(readQueuedShares()).toEqual([
      {
        id: '11111111-1111-1111-1111-111111111111',
        url: 'https://example.com/recipe',
        receivedAt: 1785600000000,
      },
    ]);
  });
});

describe('deleteQueuedShare', () => {
  it('delegates to the native bridge with the given id', () => {
    mocked.deleteSharePayload.mockReturnValue(true);
    expect(deleteQueuedShare('11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(mocked.deleteSharePayload).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });
});
