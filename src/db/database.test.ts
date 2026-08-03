import { deleteDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';

import {
  DATABASE_NAME,
  getDatabase,
  runMigrations,
  wipeDatabase,
  type MigratableDatabase,
} from './database';
import { SCHEMA_VERSION } from './schema';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));

const mockedOpenDatabaseAsync = openDatabaseAsync as jest.Mock;
const mockedDeleteDatabaseAsync = deleteDatabaseAsync as jest.Mock;

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

    const finalVersionCall = db.execAsync.mock.calls.find(([source]) =>
      /pragma user_version/i.test(source),
    );
    expect(finalVersionCall?.[0]).toBe(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    expect(
      db.execAsync.mock.calls.some(([source]) =>
        /create table if not exists recipes/i.test(source),
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
    mockedDeleteDatabaseAsync.mockResolvedValue(undefined);
  });

  // getDatabase caches a module-level singleton — reset it after every
  // test so tests don't leak a mocked handle into one another.
  afterEach(async () => {
    await wipeDatabase();
    jest.clearAllMocks();
  });

  it('opens and migrates the database once, then reuses the same handle', async () => {
    const db1 = await getDatabase();
    const db2 = await getDatabase();

    expect(mockedOpenDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(db1).toBe(db2);
  });

  it('closes the open connection and deletes the file', async () => {
    const db = await getDatabase();

    await wipeDatabase();

    expect(db.closeAsync).toHaveBeenCalled();
    expect(mockedDeleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
  });

  it('is safe to call when no database was ever opened', async () => {
    await expect(wipeDatabase()).resolves.toBeUndefined();
    expect(mockedDeleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
  });

  it('opens a brand new handle after wiping', async () => {
    await getDatabase();
    await wipeDatabase();
    mockedOpenDatabaseAsync.mockClear();

    await getDatabase();

    expect(mockedOpenDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('does not throw when deleting the underlying file fails', async () => {
    mockedDeleteDatabaseAsync.mockRejectedValue(new Error('no such file'));

    await expect(wipeDatabase()).resolves.toBeUndefined();
  });
});
