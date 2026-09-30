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
async function cacheHeroImages(
  db: LocalDb,
  recipes: SyncedRecipe[],
  generation: number,
): Promise<void> {
  for (const recipe of recipes) {
    if (generation !== heroImageGeneration) return;
    if (!recipe.heroImagePath) continue;
    try {
      const signedUrl = await getHeroImageUrl(recipe.heroImagePath);
      if (signedUrl && generation === heroImageGeneration) {
        await ensureImageCached(db, recipe.heroImagePath, signedUrl);
      }
    } catch (error) {
      logError(error, { context: 'cacheHeroImage', recipeId: recipe.id });
    }
  }
}

// Downloads run after sync returns, so screens repaint on recipe data
// rather than waiting on photos (#200). One queue, one download at a
// time: evictOverBudget reads-then-deletes, so sync never runs two at once.
let heroImageQueue: Promise<void> = Promise.resolve();
let heroImageGeneration = 0;

function scheduleHeroImageCaching(db: LocalDb, recipes: SyncedRecipe[]): void {
  if (!recipes.some((recipe) => recipe.heroImagePath)) return;
  const generation = heroImageGeneration;
  heroImageQueue = heroImageQueue.then(() => cacheHeroImages(db, recipes, generation));
}

/**
 * Drops queued downloads. The sign-out wipe calls this first — the wipe
 * reuses the open connection, so a download landing after it would
 * write the previous household's photo back into the cleared cache.
 * A download already in flight still finishes.
 */
export function cancelHeroImageCaching(): void {
  heroImageGeneration++;
}

/** Resolves once every download queued so far has settled. */
export function heroImageCachingSettled(): Promise<void> {
  return heroImageQueue;
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
    scheduleHeroImageCaching(db, page);
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
