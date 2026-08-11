/**
 * Device-specific Cooking Mode checklist progress (COOK-03/04, ADR-0024
 * decision 1). One row per recipe, upserted on every check/uncheck —
 * resume is just the row still being there, reset is deleting it.
 *
 * Ingredient/instruction lines have no stable id of their own (Recipe's
 * sections are plain arrays, ADR-0010) — a checked item is keyed
 * `${sectionIndex}-${lineIndex}`, positional within the recipe as
 * currently loaded. Stable for the lifetime of one cooking session; an
 * edit to the recipe's sections mid-session could misalign a resumed
 * checklist, an accepted edge case (a session is short-lived, and the
 * worst case is a stale checkmark, not data loss).
 */

/** The subset of SQLiteDatabase these functions need — same pattern as
 * database.ts's MigratableDatabase and import/outbox.ts's LocalDb. */
export interface LocalDb {
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
}

export interface CookingSession {
  recipeId: string;
  checkedIngredientKeys: string[];
  checkedInstructionKeys: string[];
  updatedAt: string;
}

interface CookingSessionRow {
  recipe_id: string;
  checked_ingredient_keys: string;
  checked_instruction_keys: string;
  updated_at: string;
}

function fromRow(row: CookingSessionRow): CookingSession {
  return {
    recipeId: row.recipe_id,
    checkedIngredientKeys: JSON.parse(row.checked_ingredient_keys) as string[],
    checkedInstructionKeys: JSON.parse(row.checked_instruction_keys) as string[],
    updatedAt: row.updated_at,
  };
}

export async function getCookingSession(
  db: LocalDb,
  recipeId: string,
): Promise<CookingSession | null> {
  const row = await db.getFirstAsync<CookingSessionRow>(
    `select recipe_id, checked_ingredient_keys, checked_instruction_keys, updated_at
     from cooking_sessions
     where recipe_id = ?`,
    recipeId,
  );
  return row ? fromRow(row) : null;
}

export async function saveCookingSession(
  db: LocalDb,
  recipeId: string,
  checkedIngredientKeys: string[],
  checkedInstructionKeys: string[],
): Promise<void> {
  await db.runAsync(
    `insert into cooking_sessions
       (recipe_id, checked_ingredient_keys, checked_instruction_keys, updated_at)
     values (?, ?, ?, ?)
     on conflict (recipe_id) do update
       set checked_ingredient_keys = excluded.checked_ingredient_keys,
           checked_instruction_keys = excluded.checked_instruction_keys,
           updated_at = excluded.updated_at`,
    recipeId,
    JSON.stringify(checkedIngredientKeys),
    JSON.stringify(checkedInstructionKeys),
    new Date().toISOString(),
  );
}

/** Called on Reset and as a side effect of Done Cooking (prd.md §17's
 * "clears progress") — a pure local action, independent of whether the
 * completion event itself has synced yet (ADR-0024 decision 3). */
export async function clearCookingSession(db: LocalDb, recipeId: string): Promise<void> {
  await db.runAsync(`delete from cooking_sessions where recipe_id = ?`, recipeId);
}
