import { runMigrations, type MigratableDatabase } from './database';
import { SCHEMA_VERSION } from './schema';

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
    getFirstAsync: async <T,>() => ({ user_version: userVersion }) as T,
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
      db.execAsync.mock.calls.some(([source]) => /create table if not exists recipes/i.test(source)),
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

    await expect(runMigrations(db, { 1: ['create table if not exists x (id text)'] }, 2)).rejects.toThrow(
      'Missing local migration for schema version 2',
    );
  });
});
