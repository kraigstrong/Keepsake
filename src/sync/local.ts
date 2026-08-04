import type { Category } from '../recipes/api';
import { EMPTY_CURSOR, type SyncCursor, type SyncedRecipe } from './types';

/**
 * The subset of SQLiteDatabase these functions need, so tests can pass a
 * plain mock — same pattern as database.ts's MigratableDatabase.
 */
export interface LocalDb {
  getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

interface SyncStateRow {
  recipes_cursor_updated_at: string | null;
  recipes_cursor_id: string | null;
  deletes_cursor_deleted_at: string | null;
  deletes_cursor_id: string | null;
}

export async function readSyncState(db: LocalDb, householdId: string): Promise<SyncCursor> {
  const row = await db.getFirstAsync<SyncStateRow>(
    `select recipes_cursor_updated_at, recipes_cursor_id, deletes_cursor_deleted_at, deletes_cursor_id
     from sync_state where household_id = ?`,
    householdId,
  );
  if (!row) return EMPTY_CURSOR;

  return {
    recipesCursorUpdatedAt: row.recipes_cursor_updated_at,
    recipesCursorId: row.recipes_cursor_id,
    deletesCursorDeletedAt: row.deletes_cursor_deleted_at,
    deletesCursorId: row.deletes_cursor_id,
  };
}

export async function writeSyncState(
  db: LocalDb,
  householdId: string,
  cursor: SyncCursor,
): Promise<void> {
  await db.runAsync(
    `insert into sync_state
       (household_id, recipes_cursor_updated_at, recipes_cursor_id,
        deletes_cursor_deleted_at, deletes_cursor_id, last_synced_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict (household_id) do update set
       recipes_cursor_updated_at = excluded.recipes_cursor_updated_at,
       recipes_cursor_id = excluded.recipes_cursor_id,
       deletes_cursor_deleted_at = excluded.deletes_cursor_deleted_at,
       deletes_cursor_id = excluded.deletes_cursor_id,
       last_synced_at = excluded.last_synced_at`,
    householdId,
    cursor.recipesCursorUpdatedAt,
    cursor.recipesCursorId,
    cursor.deletesCursorDeletedAt,
    cursor.deletesCursorId,
    new Date().toISOString(),
  );
}

// Transactional: every recipe in the page is written atomically, so an
// interrupted sync never leaves a page half-applied (execution-plan.md's
// "transactional writes" requirement).
export async function upsertRecipes(db: LocalDb, recipes: SyncedRecipe[]): Promise<void> {
  if (recipes.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const recipe of recipes) {
      await db.runAsync(
        `insert into recipes
           (id, household_id, version, title, hero_image_path, active_time_minutes,
            total_time_minutes, yield_text, permanent_notes, source_url, source_attribution,
            tags, category_ids, ingredient_sections, instruction_sections, updated_at, synced_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set
           household_id = excluded.household_id,
           version = excluded.version,
           title = excluded.title,
           hero_image_path = excluded.hero_image_path,
           active_time_minutes = excluded.active_time_minutes,
           total_time_minutes = excluded.total_time_minutes,
           yield_text = excluded.yield_text,
           permanent_notes = excluded.permanent_notes,
           source_url = excluded.source_url,
           source_attribution = excluded.source_attribution,
           tags = excluded.tags,
           category_ids = excluded.category_ids,
           ingredient_sections = excluded.ingredient_sections,
           instruction_sections = excluded.instruction_sections,
           updated_at = excluded.updated_at,
           synced_at = excluded.synced_at`,
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
        new Date().toISOString(),
      );
    }
  });
}

export async function deleteRecipes(db: LocalDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('delete from recipes where id = ?', id);
    }
  });
}

// Full refetch-and-replace, no cursor — categories is a small global
// lookup table (ADR-0013).
export async function replaceCategories(db: LocalDb, categories: Category[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('delete from categories');
    for (const category of categories) {
      await db.runAsync(
        'insert into categories (id, group_name, value) values (?, ?, ?)',
        category.id,
        category.groupName,
        category.value,
      );
    }
  });
}
