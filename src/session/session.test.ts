import * as SecureStore from 'expo-secure-store';

import { clearStoredSession, getStoredSession, storeSession } from './session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

afterEach(() => jest.clearAllMocks());

describe('getStoredSession', () => {
  it('returns null when nothing is stored', async () => {
    mocked.getItemAsync.mockResolvedValue(null);
    expect(await getStoredSession()).toBeNull();
  });

  it('returns the parsed session when a well-formed one is stored', async () => {
    mocked.getItemAsync.mockResolvedValue('{"userId":"user-123"}');
    expect(await getStoredSession()).toEqual({ userId: 'user-123' });
  });

  it.each([
    ['invalid JSON', 'not json'],
    ['missing userId', '{}'],
    ['non-string userId', '{"userId":123}'],
  ])('returns null for %s rather than throwing', async (_label, raw) => {
    mocked.getItemAsync.mockResolvedValue(raw);
    expect(await getStoredSession()).toBeNull();
  });
});

describe('storeSession', () => {
  it('persists the session as JSON', async () => {
    await storeSession({ userId: 'user-123' });
    expect(mocked.setItemAsync).toHaveBeenCalledWith('keepsake-session', '{"userId":"user-123"}');
  });
});

describe('clearStoredSession', () => {
  it('deletes the stored session', async () => {
    await clearStoredSession();
    expect(mocked.deleteItemAsync).toHaveBeenCalledWith('keepsake-session');
  });
});
