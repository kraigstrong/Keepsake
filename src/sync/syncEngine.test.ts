import { getDatabase } from '../db/database';
import { logError } from '../observability';
import { getHeroImageUrl } from '../recipes/heroImage';
import { ensureImageCached } from './imageCache';
import {
  deleteRecipes,
  readSyncState,
  replaceCategories,
  upsertRecipes,
  writeSyncState,
} from './local';
import { fetchAllCategories, fetchChangedRecipes, fetchDeletedRecipes } from './remote';
import { syncHousehold } from './syncEngine';
import {
  EMPTY_CURSOR,
  SYNC_PAGE_SIZE,
  type DeletedRecipeTombstone,
  type SyncedRecipe,
} from './types';

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn() }));
jest.mock('../recipes/heroImage', () => ({ getHeroImageUrl: jest.fn() }));
jest.mock('./imageCache', () => ({ ensureImageCached: jest.fn() }));
jest.mock('./local', () => ({
  readSyncState: jest.fn(),
  writeSyncState: jest.fn(),
  upsertRecipes: jest.fn(),
  deleteRecipes: jest.fn(),
  replaceCategories: jest.fn(),
}));
jest.mock('./remote', () => ({
  fetchChangedRecipes: jest.fn(),
  fetchDeletedRecipes: jest.fn(),
  fetchAllCategories: jest.fn(),
}));

const FAKE_DB = { name: 'fake-db' };

const mockedGetDatabase = getDatabase as jest.Mock;
const mockedReadSyncState = readSyncState as jest.Mock;
const mockedFetchChangedRecipes = fetchChangedRecipes as jest.Mock;
const mockedFetchDeletedRecipes = fetchDeletedRecipes as jest.Mock;
const mockedFetchAllCategories = fetchAllCategories as jest.Mock;
const mockedUpsertRecipes = upsertRecipes as jest.Mock;
const mockedDeleteRecipes = deleteRecipes as jest.Mock;
const mockedReplaceCategories = replaceCategories as jest.Mock;
const mockedWriteSyncState = writeSyncState as jest.Mock;
const mockedGetHeroImageUrl = getHeroImageUrl as jest.Mock;
const mockedEnsureImageCached = ensureImageCached as jest.Mock;
const mockedLogError = logError as jest.Mock;

function makeRecipe(
  id: string,
  updatedAt: string,
  heroImagePath: string | null = null,
): SyncedRecipe {
  return {
    id,
    householdId: 'h1',
    version: 1,
    title: id,
    heroImagePath,
    originalPhotoPath: null,
    activeTimeMinutes: null,
    totalTimeMinutes: null,
    yieldText: null,
    servingsCount: null,
    plannedCount: 0,
    permanentNotes: null,
    sourceUrl: null,
    sourceAttribution: null,
    tags: [],
    categoryIds: [],
    ingredientSections: [],
    instructionSections: [],
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
  };
}

function makeTombstone(id: string, deletedAt: string): DeletedRecipeTombstone {
  return { id, householdId: 'h1', deletedAt };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue(FAKE_DB);
  mockedReadSyncState.mockResolvedValue(EMPTY_CURSOR);
  mockedFetchChangedRecipes.mockResolvedValue([]);
  mockedFetchDeletedRecipes.mockResolvedValue([]);
  mockedFetchAllCategories.mockResolvedValue([]);
  mockedGetHeroImageUrl.mockResolvedValue('https://signed.example/hero.jpg');
});

describe('syncHousehold', () => {
  it('does nothing to local recipes when there is nothing new, but still refreshes categories', async () => {
    await syncHousehold('h1');

    expect(mockedUpsertRecipes).not.toHaveBeenCalled();
    expect(mockedDeleteRecipes).not.toHaveBeenCalled();
    expect(mockedFetchAllCategories).toHaveBeenCalledTimes(1);
    expect(mockedReplaceCategories).toHaveBeenCalledWith(FAKE_DB, []);
  });

  it('starts from the persisted cursor, not from scratch, on every call', async () => {
    const persistedCursor = {
      recipesCursorUpdatedAt: '2026-08-04T00:00:00.000Z',
      recipesCursorId: 'r0',
      deletesCursorDeletedAt: null,
      deletesCursorId: null,
    };
    mockedReadSyncState.mockResolvedValue(persistedCursor);

    await syncHousehold('h1');

    expect(mockedFetchChangedRecipes).toHaveBeenCalledWith('2026-08-04T00:00:00.000Z', 'r0');
  });

  it('pages through changed recipes, committing the cursor after every page', async () => {
    const fullPage = Array.from({ length: SYNC_PAGE_SIZE }, (_, i) =>
      makeRecipe(`r${i}`, '2026-08-05T00:00:00.000Z'),
    );
    const finalPage = [makeRecipe('r-last', '2026-08-06T00:00:00.000Z')];
    mockedFetchChangedRecipes
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(finalPage)
      .mockResolvedValueOnce([]);

    await syncHousehold('h1');

    expect(mockedFetchChangedRecipes).toHaveBeenCalledTimes(2);
    expect(mockedUpsertRecipes).toHaveBeenNthCalledWith(1, FAKE_DB, fullPage, expect.any(Map));
    expect(mockedUpsertRecipes).toHaveBeenNthCalledWith(2, FAKE_DB, finalPage, expect.any(Map));

    // Cursor committed after the first (full) page, advancing to its last row —
    // this is what lets an interrupted sync resume instead of re-fetching.
    expect(mockedWriteSyncState.mock.calls[0]).toEqual([
      FAKE_DB,
      'h1',
      expect.objectContaining({
        recipesCursorUpdatedAt: '2026-08-05T00:00:00.000Z',
        recipesCursorId: `r${SYNC_PAGE_SIZE - 1}`,
      }),
    ]);
    // Committed again after the shorter final page.
    expect(mockedWriteSyncState.mock.calls[1]).toEqual([
      FAKE_DB,
      'h1',
      expect.objectContaining({
        recipesCursorUpdatedAt: '2026-08-06T00:00:00.000Z',
        recipesCursorId: 'r-last',
      }),
    ]);
  });

  it('pages through deleted-recipe tombstones the same way, after recipes', async () => {
    mockedFetchDeletedRecipes
      .mockResolvedValueOnce([makeTombstone('gone1', '2026-08-05T00:00:00.000Z')])
      .mockResolvedValueOnce([]);

    await syncHousehold('h1');

    expect(mockedDeleteRecipes).toHaveBeenCalledWith(FAKE_DB, ['gone1']);
  });

  it('pre-caches hero images for changed recipes that have one, skipping those that do not', async () => {
    mockedFetchChangedRecipes
      .mockResolvedValueOnce([
        makeRecipe('r1', '2026-08-05T00:00:00.000Z', 'h1/r1.jpg'),
        makeRecipe('r2', '2026-08-05T00:00:00.000Z'), // no hero image
      ])
      .mockResolvedValueOnce([]);

    await syncHousehold('h1');

    expect(mockedGetHeroImageUrl).toHaveBeenCalledTimes(1);
    expect(mockedGetHeroImageUrl).toHaveBeenCalledWith('h1/r1.jpg');
    expect(mockedEnsureImageCached).toHaveBeenCalledWith(
      FAKE_DB,
      'h1/r1.jpg',
      'https://signed.example/hero.jpg',
    );
  });

  it('does not cache anything when the signed URL cannot be resolved', async () => {
    mockedGetHeroImageUrl.mockResolvedValue(null);
    mockedFetchChangedRecipes
      .mockResolvedValueOnce([makeRecipe('r1', '2026-08-05T00:00:00.000Z', 'h1/r1.jpg')])
      .mockResolvedValueOnce([]);

    await syncHousehold('h1');

    expect(mockedEnsureImageCached).not.toHaveBeenCalled();
  });

  it('logs and continues when caching one image fails, without blocking the rest of the sync', async () => {
    mockedEnsureImageCached.mockRejectedValueOnce(new Error('disk full'));
    mockedFetchChangedRecipes
      .mockResolvedValueOnce([makeRecipe('r1', '2026-08-05T00:00:00.000Z', 'h1/r1.jpg')])
      .mockResolvedValueOnce([]);

    await expect(syncHousehold('h1')).resolves.toBeUndefined();

    expect(mockedLogError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ recipeId: 'r1' }),
    );
    // The recipe's own data still synced despite the image failure.
    expect(mockedUpsertRecipes).toHaveBeenCalled();
  });

  it('always refreshes categories, even with nothing else to sync', async () => {
    mockedFetchAllCategories.mockResolvedValue([
      { id: 'c1', groupName: 'protein', value: 'Chicken' },
    ]);

    await syncHousehold('h1');

    expect(mockedReplaceCategories).toHaveBeenCalledWith(FAKE_DB, [
      { id: 'c1', groupName: 'protein', value: 'Chicken' },
    ]);
  });

  it("passes this same sync pass's freshly-fetched category labels to upsertRecipes for search indexing", async () => {
    mockedFetchAllCategories.mockResolvedValue([
      { id: 'c1', groupName: 'protein', value: 'Chicken' },
    ]);
    mockedFetchChangedRecipes
      .mockResolvedValueOnce([makeRecipe('r1', '2026-08-05T00:00:00.000Z')])
      .mockResolvedValueOnce([]);

    await syncHousehold('h1');

    const [, , categoryLabelsById] = mockedUpsertRecipes.mock.calls[0]!;
    expect(categoryLabelsById.get('c1')).toBe('Chicken');
  });
});
