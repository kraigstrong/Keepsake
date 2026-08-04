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
  type LocalDb,
} from './local';
import { fetchAllCategories, fetchChangedRecipes, fetchDeletedRecipes } from './remote';
import { SYNC_PAGE_SIZE, type SyncCursor, type SyncedRecipe } from './types';

// Best-effort, per image — a failed download shouldn't block the
// recipe's own data from syncing (execution-plan.md's "cached images"
// is additive, not sync-blocking). Pre-caches while online (sync only
// runs when reachable) so the image is already local by the time the
// user might open this recipe offline.
async function cacheHeroImages(db: LocalDb, recipes: SyncedRecipe[]): Promise<void> {
  for (const recipe of recipes) {
    if (!recipe.heroImagePath) continue;
    try {
      const signedUrl = await getHeroImageUrl(recipe.heroImagePath);
      if (signedUrl) {
        await ensureImageCached(db, recipe.heroImagePath, signedUrl);
      }
    } catch (error) {
      logError(error, { context: 'cacheHeroImage', recipeId: recipe.id });
    }
  }
}

/**
 * Cursor is written after every page, not just at the end — an
 * interrupted sync (execution-plan.md's Phase 6 validation bullet)
 * resumes from the last committed page instead of re-fetching or losing
 * progress.
 */
async function syncChangedRecipes(
  db: LocalDb,
  householdId: string,
  cursor: SyncCursor,
  categoryLabelsById: ReadonlyMap<string, string>,
): Promise<SyncCursor> {
  let current = cursor;

  for (;;) {
    const page = await fetchChangedRecipes(current.recipesCursorUpdatedAt, current.recipesCursorId);
    if (page.length === 0) break;

    await upsertRecipes(db, page, categoryLabelsById);
    await cacheHeroImages(db, page);
    const last = page[page.length - 1]!; // just checked page.length > 0 above
    current = { ...current, recipesCursorUpdatedAt: last.updatedAt, recipesCursorId: last.id };
    await writeSyncState(db, householdId, current);

    if (page.length < SYNC_PAGE_SIZE) break;
  }

  return current;
}

async function syncDeletedRecipes(
  db: LocalDb,
  householdId: string,
  cursor: SyncCursor,
): Promise<SyncCursor> {
  let current = cursor;

  for (;;) {
    const page = await fetchDeletedRecipes(current.deletesCursorDeletedAt, current.deletesCursorId);
    if (page.length === 0) break;

    await deleteRecipes(
      db,
      page.map((tombstone) => tombstone.id),
    );
    const last = page[page.length - 1]!; // just checked page.length > 0 above
    current = { ...current, deletesCursorDeletedAt: last.deletedAt, deletesCursorId: last.id };
    await writeSyncState(db, householdId, current);

    if (page.length < SYNC_PAGE_SIZE) break;
  }

  return current;
}

/**
 * Full initial sync when the local cursor is empty, incremental pull
 * otherwise — the same code path handles both (ADR-0013), since a null
 * cursor just means "no filter," fetching everything.
 */
export async function syncHousehold(householdId: string): Promise<void> {
  const db = await getDatabase();
  const cursor = await readSyncState(db, householdId);

  // Fetched once up front, not after recipes: search indexing (inside
  // syncChangedRecipes) needs category labels for the categories FTS
  // column, and using this same in-memory fetch keeps that lookup fresh
  // within a sync pass rather than reading the local table's previous
  // (possibly stale) contents.
  const categories = await fetchAllCategories();
  const categoryLabelsById = new Map(categories.map((category) => [category.id, category.value]));

  const afterRecipes = await syncChangedRecipes(db, householdId, cursor, categoryLabelsById);
  await syncDeletedRecipes(db, householdId, afterRecipes);

  await replaceCategories(db, categories);
}
