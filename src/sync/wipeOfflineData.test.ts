import { wipeDatabase } from '../db/database';
import type { ImageStore } from './imageCache';
import { wipeOfflineData } from './wipeOfflineData';

jest.mock('../db/database', () => ({ wipeDatabase: jest.fn() }));

const mockedWipeDatabase = wipeDatabase as jest.Mock;

afterEach(() => jest.clearAllMocks());

it('wipes the database and clears the entire image cache directory', async () => {
  mockedWipeDatabase.mockResolvedValue(undefined);
  const deleteDirectory = jest.fn();
  const imageStore = { deleteDirectory } as unknown as ImageStore;

  await wipeOfflineData(imageStore);

  expect(mockedWipeDatabase).toHaveBeenCalled();
  expect(deleteDirectory).toHaveBeenCalled();
});
