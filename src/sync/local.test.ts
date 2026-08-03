import {
  deleteRecipes,
  readSyncState,
  replaceCategories,
  upsertRecipes,
  writeSyncState,
  type LocalDb,
} from './local';
import { EMPTY_CURSOR, type SyncedRecipe } from './types';

function createMockDb(overrides: Partial<LocalDb> = {}): LocalDb & {
  runAsync: jest.Mock;
  getFirstAsync: jest.Mock;
} {
  return {
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async () => []),
    runAsync: jest.fn(async () => undefined),
    withTransactionAsync: async (task) => {
      await task();
    },
    ...overrides,
  } as LocalDb & { runAsync: jest.Mock; getFirstAsync: jest.Mock };
}

const recipe: SyncedRecipe = {
  id: 'r1',
  householdId: 'h1',
  version: 1,
  title: 'Chili',
  heroImagePath: null,
  activeTimeMinutes: null,
  totalTimeMinutes: null,
  yieldText: null,
  permanentNotes: null,
  sourceUrl: null,
  sourceAttribution: null,
  tags: ['spicy'],
  categoryIds: ['c1'],
  ingredientSections: [{ title: null, lines: ['1 lb beef'] }],
  instructionSections: [{ title: null, lines: ['Brown the beef.'] }],
  updatedAt: '2026-08-05T00:00:00.000Z',
};

describe('readSyncState', () => {
  it('returns EMPTY_CURSOR when no row exists for the household (first sync)', async () => {
    const db = createMockDb();
    await expect(readSyncState(db, 'h1')).resolves.toEqual(EMPTY_CURSOR);
  });

  it('maps a persisted row back to a SyncCursor', async () => {
    const db = createMockDb({
      getFirstAsync: async <T,>() =>
        ({
          recipes_cursor_updated_at: '2026-08-05T00:00:00.000Z',
          recipes_cursor_id: 'r1',
          deletes_cursor_deleted_at: null,
          deletes_cursor_id: null,
        }) as T,
    });

    await expect(readSyncState(db, 'h1')).resolves.toEqual({
      recipesCursorUpdatedAt: '2026-08-05T00:00:00.000Z',
      recipesCursorId: 'r1',
      deletesCursorDeletedAt: null,
      deletesCursorId: null,
    });
  });
});

describe('writeSyncState', () => {
  it('upserts the cursor keyed by household_id', async () => {
    const db = createMockDb();
    const cursor = {
      recipesCursorUpdatedAt: '2026-08-05T00:00:00.000Z',
      recipesCursorId: 'r1',
      deletesCursorDeletedAt: null,
      deletesCursorId: null,
    };

    await writeSyncState(db, 'h1', cursor);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (household_id)'),
      'h1',
      cursor.recipesCursorUpdatedAt,
      cursor.recipesCursorId,
      cursor.deletesCursorDeletedAt,
      cursor.deletesCursorId,
      expect.any(String),
    );
  });
});

describe('upsertRecipes', () => {
  it('is a no-op for an empty page (no transaction opened)', async () => {
    const db = createMockDb();
    const withTransactionAsync = jest.fn();

    await upsertRecipes({ ...db, withTransactionAsync }, []);

    expect(withTransactionAsync).not.toHaveBeenCalled();
  });

  it('serializes JSON columns and writes one row per recipe inside a transaction', async () => {
    const db = createMockDb();

    await upsertRecipes(db, [recipe]);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into recipes'),
      recipe.id,
      recipe.householdId,
      recipe.version,
      recipe.title,
      recipe.heroImagePath,
      recipe.activeTimeMinutes,
      recipe.totalTimeMinutes,
      recipe.yieldText,
      recipe.permanentNotes,
      recipe.sourceUrl,
      recipe.sourceAttribution,
      JSON.stringify(recipe.tags),
      JSON.stringify(recipe.categoryIds),
      JSON.stringify(recipe.ingredientSections),
      JSON.stringify(recipe.instructionSections),
      recipe.updatedAt,
      expect.any(String),
    );
  });
});

describe('deleteRecipes', () => {
  it('is a no-op for an empty id list', async () => {
    const db = createMockDb();
    const withTransactionAsync = jest.fn();

    await deleteRecipes({ ...db, withTransactionAsync }, []);

    expect(withTransactionAsync).not.toHaveBeenCalled();
  });

  it('deletes each given id', async () => {
    const db = createMockDb();

    await deleteRecipes(db, ['r1', 'r2']);

    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'delete from recipes where id = ?', 'r1');
    expect(db.runAsync).toHaveBeenNthCalledWith(2, 'delete from recipes where id = ?', 'r2');
  });
});

describe('replaceCategories', () => {
  it('clears the table before inserting the fresh set', async () => {
    const db = createMockDb();

    await replaceCategories(db, [{ id: 'c1', groupName: 'protein', value: 'Chicken' }]);

    expect(db.runAsync).toHaveBeenNthCalledWith(1, 'delete from categories');
    expect(db.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into categories'),
      'c1',
      'protein',
      'Chicken',
    );
  });
});
