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
// server mirror. Not a per-household filtered delete — MVP is one
// household per user (ADR-0004), so there's never a second household's
// cache to preserve.
const RECIPE_MIRROR_TABLES = [
  'recipes',
  'categories',
  'sync_state',
  'cached_images',
  'recipe_fts',
  'recipe_trigram',
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
