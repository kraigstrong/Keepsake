import {
  clearCookingSession,
  getCookingSession,
  saveCookingSession,
  type LocalDb,
} from './checklistState';

function createMockDb(
  overrides: Record<string, jest.Mock> = {},
): LocalDb & { runAsync: jest.Mock; getFirstAsync: jest.Mock } {
  return {
    getFirstAsync: jest.fn(async () => null),
    runAsync: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as LocalDb & { runAsync: jest.Mock; getFirstAsync: jest.Mock };
}

const RECIPE_ID = 'recipe1';

describe('getCookingSession', () => {
  it('returns null when no session exists for the recipe', async () => {
    const db = createMockDb();
    await expect(getCookingSession(db, RECIPE_ID)).resolves.toBeNull();
    expect(db.getFirstAsync).toHaveBeenCalledWith(expect.any(String), RECIPE_ID);
  });

  it('parses the stored JSON key arrays', async () => {
    const db = createMockDb({
      getFirstAsync: jest.fn(async () => ({
        recipe_id: RECIPE_ID,
        checked_ingredient_keys: JSON.stringify(['0-0', '0-1']),
        checked_instruction_keys: JSON.stringify(['0-0']),
        updated_at: '2026-08-10T18:00:00.000Z',
      })),
    });

    await expect(getCookingSession(db, RECIPE_ID)).resolves.toEqual({
      recipeId: RECIPE_ID,
      checkedIngredientKeys: ['0-0', '0-1'],
      checkedInstructionKeys: ['0-0'],
      updatedAt: '2026-08-10T18:00:00.000Z',
    });
  });
});

describe('saveCookingSession', () => {
  it('upserts the checked key arrays as JSON', async () => {
    const db = createMockDb();

    await saveCookingSession(db, RECIPE_ID, ['0-0'], []);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into cooking_sessions'),
      RECIPE_ID,
      JSON.stringify(['0-0']),
      JSON.stringify([]),
      expect.any(String),
    );
    expect(db.runAsync.mock.calls[0][0]).toContain('on conflict (recipe_id) do update');
  });
});

describe('clearCookingSession', () => {
  it('deletes the row for the recipe', async () => {
    const db = createMockDb();
    await clearCookingSession(db, RECIPE_ID);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('delete from cooking_sessions'),
      RECIPE_ID,
    );
  });
});
