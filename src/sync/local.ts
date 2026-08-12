import type { Category } from '../recipes/api';
import { flattenRecipeForSearch } from '../search/indexRecipe';
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

// FTS5 tables aren't external-content against `recipes` (ADR-0014 —
// recipes.id is a text UUID, and relying on SQLite's implicit rowid for
// external-content linking isn't VACUUM-stable). Maintained explicitly
// here instead of via SQL triggers: delete-then-reinsert on every
// upsert, matching FTS5's own recommended pattern for content changes.
async function indexRecipeForSearch(
  db: LocalDb,
  recipe: SyncedRecipe,
  categoryLabelsById: ReadonlyMap<string, string>,
): Promise<void> {
  await deindexRecipeForSearch(db, recipe.id);
  const row = flattenRecipeForSearch(recipe, categoryLabelsById);
  await db.runAsync(
    `insert into recipe_fts
       (recipe_id, title, ingredients, notes, source_attribution, source_url, categories, tags)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.recipeId,
    row.title,
    row.ingredients,
    row.notes,
    row.sourceAttribution,
    row.sourceUrl,
    row.categories,
    row.tags,
  );
  await db.runAsync(
    'insert into recipe_trigram (recipe_id, title) values (?, ?)',
    row.recipeId,
    row.title,
  );
}

async function deindexRecipeForSearch(db: LocalDb, recipeId: string): Promise<void> {
  await db.runAsync('delete from recipe_fts where recipe_id = ?', recipeId);
  await db.runAsync('delete from recipe_trigram where recipe_id = ?', recipeId);
}

// Transactional: every recipe in the page is written atomically, so an
// interrupted sync never leaves a page half-applied (execution-plan.md's
// "transactional writes" requirement). categoryLabelsById comes from the
// same sync pass's fresh category fetch (syncEngine.ts), not a read of
// the local categories table, so indexing never lags a same-sync rename.
export async function upsertRecipes(
  db: LocalDb,
  recipes: SyncedRecipe[],
  categoryLabelsById: ReadonlyMap<string, string>,
): Promise<void> {
  if (recipes.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const recipe of recipes) {
      await db.runAsync(
        `insert into recipes
           (id, household_id, version, title, hero_image_path, original_photo_path,
            active_time_minutes, total_time_minutes, yield_text, servings_count, planned_count, permanent_notes, source_url,
            source_attribution, tags, category_ids, ingredient_sections, instruction_sections,
            created_at, updated_at, archived_at, deleted_at, synced_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set
           household_id = excluded.household_id,
           version = excluded.version,
           title = excluded.title,
           hero_image_path = excluded.hero_image_path,
           original_photo_path = excluded.original_photo_path,
           active_time_minutes = excluded.active_time_minutes,
           total_time_minutes = excluded.total_time_minutes,
           yield_text = excluded.yield_text,
           servings_count = excluded.servings_count,
           planned_count = excluded.planned_count,
           permanent_notes = excluded.permanent_notes,
           source_url = excluded.source_url,
           source_attribution = excluded.source_attribution,
           tags = excluded.tags,
           category_ids = excluded.category_ids,
           ingredient_sections = excluded.ingredient_sections,
           instruction_sections = excluded.instruction_sections,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at,
           deleted_at = excluded.deleted_at,
           synced_at = excluded.synced_at`,
        recipe.id,
        recipe.householdId,
        recipe.version,
        recipe.title,
        recipe.heroImagePath,
        recipe.originalPhotoPath,
        recipe.activeTimeMinutes,
        recipe.totalTimeMinutes,
        recipe.yieldText,
        recipe.servingsCount,
        recipe.plannedCount,
        recipe.permanentNotes,
        recipe.sourceUrl,
        recipe.sourceAttribution,
        JSON.stringify(recipe.tags),
        JSON.stringify(recipe.categoryIds),
        JSON.stringify(recipe.ingredientSections),
        JSON.stringify(recipe.instructionSections),
        recipe.createdAt,
        recipe.updatedAt,
        recipe.archivedAt,
        recipe.deletedAt,
        new Date().toISOString(),
      );
      await indexRecipeForSearch(db, recipe, categoryLabelsById);
    }
  });
}

export async function deleteRecipes(db: LocalDb, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const id of ids) {
      await db.runAsync('delete from recipes where id = ?', id);
      await deindexRecipeForSearch(db, id);
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
