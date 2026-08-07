import { getDatabase } from '../db/database';
import type { ImageStore } from './imageCache';
import {
  readCachedImageUri,
  readLocalCategories,
  readLocalLibraryRecipes,
  readLocalRecipe,
} from './offlineRecipes';

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));

const mockedGetDatabase = getDatabase as jest.Mock;

function createMockDb(overrides: Record<string, jest.Mock> = {}) {
  return {
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

const HOUSEHOLD_ID = 'hh1';

describe('readLocalLibraryRecipes', () => {
  it('reads and deserializes the fields Library sort/filter needs, ordered by title', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        {
          id: 'r1',
          title: 'Chili',
          created_at: '2026-08-01T00:00:00.000Z',
          category_ids: JSON.stringify(['c1']),
          tags: JSON.stringify(['spicy']),
          planned_count: 2,
        },
      ]),
    });
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readLocalLibraryRecipes(HOUSEHOLD_ID)).resolves.toEqual([
      {
        id: 'r1',
        title: 'Chili',
        createdAt: '2026-08-01T00:00:00.000Z',
        categoryIds: ['c1'],
        tags: ['spicy'],
        plannedCount: 2,
      },
    ]);
    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select id, title, created_at, category_ids, tags, planned_count from recipes where household_id = ? order by title',
      HOUSEHOLD_ID,
    );
  });

  it('falls back a null created_at (pre-schema-v3-resync row) to the epoch, not "now"', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        { id: 'r1', title: 'Chili', created_at: null, category_ids: '[]', tags: '[]', planned_count: 0 },
      ]),
    });
    mockedGetDatabase.mockResolvedValue(db);

    const [result] = await readLocalLibraryRecipes(HOUSEHOLD_ID);
    expect(result!.createdAt).toBe(new Date(0).toISOString());
  });
});

describe('readLocalRecipe', () => {
  it('returns null when the recipe has never been synced locally', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readLocalRecipe('missing', HOUSEHOLD_ID)).resolves.toBeNull();
  });

  it('scopes the read to the given household_id, not id alone', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await readLocalRecipe('r1', HOUSEHOLD_ID);

    expect(db.getFirstAsync).toHaveBeenCalledWith(
      'select * from recipes where id = ? and household_id = ?',
      'r1',
      HOUSEHOLD_ID,
    );
  });

  it('deserializes the JSON columns back into a full Recipe', async () => {
    const db = createMockDb({
      getFirstAsync: jest.fn(async () => ({
        id: 'r1',
        version: 2,
        title: 'Chili',
        hero_image_path: 'h1/r1.jpg',
        active_time_minutes: 20,
        total_time_minutes: 60,
        yield_text: 'Serves 4',
        permanent_notes: null,
        source_url: null,
        source_attribution: null,
        tags: JSON.stringify(['spicy']),
        category_ids: JSON.stringify(['c1']),
        ingredient_sections: JSON.stringify([{ title: null, lines: ['1 lb beef'] }]),
        instruction_sections: JSON.stringify([{ title: null, lines: ['Brown the beef.'] }]),
      })),
    });
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readLocalRecipe('r1', HOUSEHOLD_ID)).resolves.toEqual({
      id: 'r1',
      version: 2,
      title: 'Chili',
      heroImagePath: 'h1/r1.jpg',
      activeTimeMinutes: 20,
      totalTimeMinutes: 60,
      yieldText: 'Serves 4',
      permanentNotes: null,
      sourceUrl: null,
      sourceAttribution: null,
      tags: ['spicy'],
      categoryIds: ['c1'],
      ingredientSections: [{ title: null, lines: ['1 lb beef'] }],
      instructionSections: [{ title: null, lines: ['Brown the beef.'] }],
    });
  });
});

describe('readLocalCategories', () => {
  it('aliases group_name to groupName', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await readLocalCategories();

    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select id, group_name as groupName, value from categories order by value',
    );
  });
});

describe('readCachedImageUri', () => {
  it('returns the local uri when the image is cached and the file still exists', async () => {
    const db = createMockDb({
      getFirstAsync: jest.fn(async () => ({ local_uri: 'file:///cache/hero-images/r1.jpg' })),
    });
    mockedGetDatabase.mockResolvedValue(db);
    const imageStore = { fileExists: jest.fn(() => true) } as unknown as ImageStore;

    await expect(readCachedImageUri('h1/r1.jpg', imageStore)).resolves.toBe(
      'file:///cache/hero-images/r1.jpg',
    );
  });

  it('returns null when the image has not been cached yet', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readCachedImageUri('h1/r1.jpg')).resolves.toBeNull();
  });

  it('returns null when a cached row exists but its file is gone (e.g. iOS purged Library/Caches/)', async () => {
    const db = createMockDb({
      getFirstAsync: jest.fn(async () => ({ local_uri: 'file:///cache/hero-images/r1.jpg' })),
    });
    mockedGetDatabase.mockResolvedValue(db);
    const imageStore = { fileExists: jest.fn(() => false) } as unknown as ImageStore;

    await expect(readCachedImageUri('h1/r1.jpg', imageStore)).resolves.toBeNull();
    expect(imageStore.fileExists).toHaveBeenCalledWith('file:///cache/hero-images/r1.jpg');
  });
});
