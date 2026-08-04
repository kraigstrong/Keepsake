import AsyncStorage from '@react-native-async-storage/async-storage';

import { readSortPreference, writeSortPreference } from './sortPreference';

afterEach(() => AsyncStorage.clear());

describe('readSortPreference', () => {
  it('defaults to smart when nothing has been stored yet', async () => {
    await expect(readSortPreference()).resolves.toBe('smart');
  });

  it('returns a previously written preference', async () => {
    await writeSortPreference('alphabetical');
    await expect(readSortPreference()).resolves.toBe('alphabetical');
  });

  it('falls back to smart for a stored value that is not a recognized sort mode', async () => {
    await AsyncStorage.setItem('keepsake.library.sortMode', 'frequentlySelected');
    await expect(readSortPreference()).resolves.toBe('smart');
  });

  it('falls back to smart when the read itself fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk error'));
    await expect(readSortPreference()).resolves.toBe('smart');
  });
});

describe('writeSortPreference', () => {
  it('does not throw when the write itself fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(writeSortPreference('recentlyAdded')).resolves.toBeUndefined();
  });
});
