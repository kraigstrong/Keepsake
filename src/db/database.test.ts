import { openDatabaseAsync } from 'expo-sqlite';

import {
  __resetDatabaseConnectionForTests,
  getDatabase,
  runMigrations,
  wipeDatabase,
  type MigratableDatabase,
} from './database';
import { SCHEMA_VERSION } from './schema';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

const mockedOpenDatabaseAsync = openDatabaseAsync as jest.Mock;

function createMockDb(initialUserVersion: number): MigratableDatabase & { execAsync: jest.Mock } {
  let userVersion = initialUserVersion;

  const execAsync = jest.fn(async (source: string) => {
    const match = /pragma user_version\s*=\s*(\d+)/i.exec(source);
    if (match) {
      userVersion = Number(match[1]);
    }
  });

  return {
    execAsync,
    getFirstAsync: async <T>() => ({ user_version: userVersion }) as T,
    withTransactionAsync: async (task) => {
      await task();
    },
  };
}

describe('runMigrations', () => {
  it('applies every migration up to SCHEMA_VERSION on a fresh database', async () => {
    const db = createMockDb(0);

    await runMigrations(db);

    const versionCalls = db.execAsync.mock.calls.filter(([source]) =>
      /pragma user_version/i.test(source),
    );
    // One PRAGMA per migration applied, in order — not just the final one.
    expect(versionCalls.map(([source]) => source)).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_, i) => `PRAGMA user_version = ${i + 1}`),
    );
    expect(
      db.execAsync.mock.calls.some(([source]) =>
        /create table if not exists recipes/i.test(source),
      ),
    ).toBe(true);
    expect(
      db.execAsync.mock.calls.some(([source]) =>
        /create virtual table if not exists recipe_fts/i.test(source),
      ),
    ).toBe(true);
    expect(
      db.execAsync.mock.calls.some(([source]) =>
        /create table if not exists import_outbox/i.test(source),
      ),
    ).toBe(true);
  });

  it('is a no-op when the database is already at SCHEMA_VERSION', async () => {
    const db = createMockDb(SCHEMA_VERSION);

    await runMigrations(db);

    expect(db.execAsync).not.toHaveBeenCalled();
  });

  it('never attempts to downgrade when the database is newer than SCHEMA_VERSION', async () => {
    const db = createMockDb(SCHEMA_VERSION + 5);

    await runMigrations(db);

    expect(db.execAsync).not.toHaveBeenCalled();
  });

  it('throws rather than silently skipping a gap in the migration table', async () => {
    const db = createMockDb(0);

    await expect(
      runMigrations(db, { 1: ['create table if not exists x (id text)'] }, 2),
    ).rejects.toThrow('Missing local migration for schema version 2');
  });
});

describe('getDatabase / wipeDatabase', () => {
  function mockOpenedDb() {
    return {
      closeAsync: jest.fn(async () => undefined),
      getFirstAsync: async <T>() => ({ user_version: SCHEMA_VERSION }) as T,
      execAsync: jest.fn(),
      withTransactionAsync: async (task: () => Promise<void>) => task(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedOpenDatabaseAsync.mockImplementation(async () => mockOpenedDb());
  });

  // getDatabase caches a module-level singleton — reset it after every
  // test so tests don't leak a mocked handle into one another.
  afterEach(() => {
    __resetDatabaseConnectionForTests();
  });

  it('opens and migrates the database once, then reuses the same handle', async () => {
    const db1 = await getDatabase();
    const db2 = await getDatabase();

    expect(mockedOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(db1).toBe(db2);
  });

  it('deletes rows from the recipe-mirror tables, not the outbox, and never closes the connection', async () => {
    const db = await getDatabase();

    await wipeDatabase();

    expect(db.closeAsync).not.toHaveBeenCalled();
    const deletedTables = (db.execAsync as jest.Mock).mock.calls
      .map(([source]: [string]) => source)
      .filter((source: string) => /^delete from/i.test(source));
    expect(deletedTables).toEqual([
      'delete from recipes',
      'delete from categories',
      'delete from sync_state',
      'delete from cached_images',
      'delete from recipe_fts',
      'delete from recipe_trigram',
    ]);
    expect(deletedTables.some((source: string) => /import_outbox/i.test(source))).toBe(false);
  });

  it('opens the database on demand if wipeDatabase is called before any read', async () => {
    await expect(wipeDatabase()).resolves.toBeUndefined();
    expect(mockedOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('reuses the same handle across repeated wipes rather than reopening', async () => {
    await getDatabase();
    await wipeDatabase();
    await wipeDatabase();

    expect(mockedOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });
});
