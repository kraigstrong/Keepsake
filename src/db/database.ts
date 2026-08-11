import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export const DATABASE_NAME = 'keepsake.db';

/**
 * The subset of SQLiteDatabase runMigrations actually needs, so tests can
 * pass a plain mock instead of a real native database — same pattern as
 * createSupabaseClient's factory-for-testability (src/supabase/client.ts).
 */
export interface MigratableDatabase {
  getFirstAsync<T>(source: string): Promise<T | null>;
  execAsync(source: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * migrations/targetVersion are parameters (not read from the schema
 * module directly) so tests can exercise edge cases — like a gap in the
 * migration table — without mocking module internals. Production
 * callers rely on the defaults.
 */
export async function runMigrations(
  db: MigratableDatabase,
  migrations: Record<number, readonly string[]> = MIGRATIONS,
  targetVersion: number = SCHEMA_VERSION,
): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = row?.user_version ?? 0;

  while (currentVersion < targetVersion) {
    const nextVersion = currentVersion + 1;
    const statements = migrations[nextVersion];
    if (!statements) {
      throw new Error(`Missing local migration for schema version ${nextVersion}`);
    }

    await db.withTransactionAsync(async () => {
      for (const statement of statements) {
        await db.execAsync(statement);
      }
      await db.execAsync(`PRAGMA user_version = ${nextVersion}`);
    });
    currentVersion = nextVersion;
  }
}

let dbPromise: Promise<SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await runMigrations(db);
      return db;
    });
  }
  return dbPromise;
}

// Sign-out wipe (ADR-0013, revised by ADR-0016 decision 1): clears the
// recipe mirror by table name rather than dropping the whole database
// file, so import_outbox (Phase 9) survives sign-out — an unsent Share
// Extension submission is the only copy of that share until the server
// confirms it, unlike everything else here, which is a rebuildable
// server mirror. Best-effort cleanup, not the authorization boundary
// (ADR-0020, Phase 11.5): a wipe failure here used to mean a different
// account signing in next could read the previous one's cached recipes
// outright, since reads were never filtered by household either. Reads
// are now household-scoped (src/sync/offlineRecipes.ts,
// src/search/buildSearchQuery.ts) so a failed wipe leaves stale,
// unreadable rows behind rather than a real leak — this wipe is what
// keeps local storage tidy, not what keeps one account's data out of
// another's view.
const RECIPE_MIRROR_TABLES = [
  'recipes',
  'categories',
  'sync_state',
  'cached_images',
  'recipe_fts',
  'recipe_trigram',
  // Device-specific checklist progress (Phase 15, ADR-0024) — plain UI
  // state, safe to clear like everything else here. cooking_event_outbox
  // is deliberately NOT in this list, same reasoning as import_outbox
  // above.
  'cooking_sessions',
] as const;

export async function wipeDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const table of RECIPE_MIRROR_TABLES) {
      await db.execAsync(`delete from ${table}`);
    }
  });
}

/**
 * Test-only: forgets the cached connection so the next getDatabase() call
 * opens (and migrates) a fresh mock, simulating a new app launch. wipeDatabase()
 * itself no longer touches this cache — it reuses the open connection to
 * delete rows, it doesn't reopen one — so tests need an explicit way to reset
 * between cases instead of relying on wipeDatabase() as a side effect.
 */
export function __resetDatabaseConnectionForTests(): void {
  dbPromise = null;
}
