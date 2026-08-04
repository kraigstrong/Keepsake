import { getDatabase } from '../db/database';
import {
  readCachedImageUri,
  readLocalCategories,
  readLocalRecipe,
  readLocalRecipeSummaries,
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

describe('readLocalRecipeSummaries', () => {
  it('reads id/title from the local recipes table, ordered by title', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        { id: 'r1', title: 'Chili' },
        { id: 'r2', title: 'Tacos' },
      ]),
    });
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readLocalRecipeSummaries()).resolves.toEqual([
      { id: 'r1', title: 'Chili' },
      { id: 'r2', title: 'Tacos' },
    ]);
    expect(db.getAllAsync).toHaveBeenCalledWith('select id, title from recipes order by title');
  });
});

describe('readLocalRecipe', () => {
  it('returns null when the recipe has never been synced locally', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readLocalRecipe('missing')).resolves.toBeNull();
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

    await expect(readLocalRecipe('r1')).resolves.toEqual({
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
  it('returns the local uri when the image is cached', async () => {
    const db = createMockDb({
      getFirstAsync: jest.fn(async () => ({ local_uri: 'file:///cache/hero-images/r1.jpg' })),
    });
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readCachedImageUri('h1/r1.jpg')).resolves.toBe('file:///cache/hero-images/r1.jpg');
  });

  it('returns null when the image has not been cached yet', async () => {
    const db = createMockDb();
    mockedGetDatabase.mockResolvedValue(db);

    await expect(readCachedImageUri('h1/r1.jpg')).resolves.toBeNull();
  });
});
