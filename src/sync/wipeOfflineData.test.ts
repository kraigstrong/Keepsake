import { wipeDatabase } from '../db/database';
import type { ImageStore } from './imageCache';
import { cancelHeroImageCaching } from './syncEngine';
import { wipeOfflineData, wipeOfflineDataForAccountDeletion } from './wipeOfflineData';

jest.mock('../db/database', () => ({ wipeDatabase: jest.fn() }));
jest.mock('./syncEngine', () => ({ cancelHeroImageCaching: jest.fn() }));

const mockedWipeDatabase = wipeDatabase as jest.Mock;
const mockedCancelHeroImageCaching = cancelHeroImageCaching as jest.Mock;

afterEach(() => jest.clearAllMocks());

it('wipes the database and clears the entire image cache directory', async () => {
  mockedWipeDatabase.mockResolvedValue(undefined);
  const deleteDirectory = jest.fn();
  const imageStore = { deleteDirectory } as unknown as ImageStore;

  await wipeOfflineData(imageStore);

  expect(mockedWipeDatabase).toHaveBeenCalled();
  expect(deleteDirectory).toHaveBeenCalled();
});

it('cancels queued hero-image downloads before wiping', async () => {
  mockedWipeDatabase.mockImplementation(async () => {
    expect(mockedCancelHeroImageCaching).toHaveBeenCalled();
  });
  const imageStore = { deleteDirectory: jest.fn() } as unknown as ImageStore;

  await wipeOfflineData(imageStore);

  expect(mockedCancelHeroImageCaching).toHaveBeenCalledTimes(1);
});

it('cancels queued hero-image downloads before the account-deletion wipe too', async () => {
  mockedWipeDatabase.mockImplementation(async () => {
    expect(mockedCancelHeroImageCaching).toHaveBeenCalled();
  });
  const imageStore = { deleteDirectory: jest.fn() } as unknown as ImageStore;

  await wipeOfflineDataForAccountDeletion(imageStore);

  expect(mockedCancelHeroImageCaching).toHaveBeenCalledTimes(1);
});
