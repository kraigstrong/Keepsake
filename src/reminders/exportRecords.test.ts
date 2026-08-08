import { getExportedItemHashes, recordExport } from './exportRecords';
import type { LocalDb } from '../sync/local';

function createMockDb(overrides: Partial<LocalDb> = {}): LocalDb & {
  getAllAsync: jest.Mock;
  runAsync: jest.Mock;
} {
  return {
    getFirstAsync: async <T>() => null as T | null,
    getAllAsync: jest.fn(async () => []),
    runAsync: jest.fn(async () => undefined),
    withTransactionAsync: async (task) => {
      await task();
    },
    ...overrides,
  } as LocalDb & { getAllAsync: jest.Mock; runAsync: jest.Mock };
}

describe('getExportedItemHashes', () => {
  it('returns a set of the exported item hashes for the plan', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [{ item_hash: 'a1b2c3d4e5f60718' }, { item_hash: 'aaaa' }]),
    } as never);

    const result = await getExportedItemHashes(db, 'plan-1');

    expect(result).toEqual(new Set(['a1b2c3d4e5f60718', 'aaaa']));
    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select item_hash from grocery_exports where weekly_plan_id = ?',
      'plan-1',
    );
  });

  it('returns an empty set when nothing has been exported yet', async () => {
    const db = createMockDb();
    const result = await getExportedItemHashes(db, 'plan-1');
    expect(result).toEqual(new Set());
  });
});

describe('recordExport', () => {
  it('inserts a row with the given fields', async () => {
    const db = createMockDb();

    await recordExport(db, {
      weeklyPlanId: 'plan-1',
      itemHash: 'a1b2c3d4e5f60718',
      householdId: 'household-1',
      reminderId: 'reminder-1',
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into grocery_exports'),
      'plan-1',
      'a1b2c3d4e5f60718',
      'household-1',
      'reminder-1',
      expect.any(String),
    );
  });
});
