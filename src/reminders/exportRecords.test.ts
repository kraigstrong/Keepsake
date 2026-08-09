import { getExportedItems, recordExport } from './exportRecords';
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

describe('getExportedItems', () => {
  it('returns a map of item hash to reminder id for the plan', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        { item_hash: 'a1b2c3d4e5f60718', reminder_id: 'reminder-a' },
        { item_hash: 'aaaa', reminder_id: 'reminder-b' },
      ]),
    } as never);

    const result = await getExportedItems(db, 'plan-1');

    expect(result).toEqual(
      new Map([
        ['a1b2c3d4e5f60718', 'reminder-a'],
        ['aaaa', 'reminder-b'],
      ]),
    );
    expect(db.getAllAsync).toHaveBeenCalledWith(
      'select item_hash, reminder_id from grocery_exports where weekly_plan_id = ?',
      'plan-1',
    );
  });

  it('returns an empty map when nothing has been exported yet', async () => {
    const db = createMockDb();
    const result = await getExportedItems(db, 'plan-1');
    expect(result).toEqual(new Map());
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
