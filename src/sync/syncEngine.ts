import { getDatabase } from '../db/database';
import {
  deleteRecipes,
  readSyncState,
  replaceCategories,
  upsertRecipes,
  writeSyncState,
  type LocalDb,
} from './local';
import { fetchAllCategories, fetchChangedRecipes, fetchDeletedRecipes } from './remote';
import { SYNC_PAGE_SIZE, type SyncCursor } from './types';

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
): Promise<SyncCursor> {
  let current = cursor;

  for (;;) {
    const page = await fetchChangedRecipes(current.recipesCursorUpdatedAt, current.recipesCursorId);
    if (page.length === 0) break;

    await upsertRecipes(db, page);
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

  const afterRecipes = await syncChangedRecipes(db, householdId, cursor);
  await syncDeletedRecipes(db, householdId, afterRecipes);

  const categories = await fetchAllCategories();
  await replaceCategories(db, categories);
}
