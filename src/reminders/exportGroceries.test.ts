import { exportGroceriesToReminders, type GroceryExportItem } from './exportGroceries';
import { getExportedItemHashes, recordExport } from './exportRecords';
import { addGroceryReminder, getOwnedGroceryListId } from './reminders';
import type { LocalDb } from '../sync/local';

jest.mock('./reminders');
jest.mock('./exportRecords');

const mockedGetOwnedGroceryListId = getOwnedGroceryListId as jest.Mock;
const mockedAddGroceryReminder = addGroceryReminder as jest.Mock;
const mockedGetExportedItemHashes = getExportedItemHashes as jest.Mock;
const mockedRecordExport = recordExport as jest.Mock;

const DB = {} as LocalDb;

function item(overrides: Partial<GroceryExportItem> = {}): GroceryExportItem {
  return {
    itemHash: overrides.itemHash ?? 'hash-1',
    displayText: overrides.displayText ?? '1 onion',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetOwnedGroceryListId.mockResolvedValue('list-1');
  mockedGetExportedItemHashes.mockResolvedValue(new Set());
  mockedRecordExport.mockResolvedValue(undefined);
});

it('exports every item, recording each one locally', async () => {
  mockedAddGroceryReminder.mockResolvedValueOnce('r1').mockResolvedValueOnce('r2');

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion' }), item({ itemHash: 'garlic' })],
  });

  expect(outcome).toEqual({ succeeded: ['onion', 'garlic'], skipped: [], partial: [], failed: [] });
  expect(mockedAddGroceryReminder).toHaveBeenCalledWith('list-1', '1 onion');
  expect(mockedRecordExport).toHaveBeenCalledWith(DB, {
    weeklyPlanId: 'plan-1',
    itemHash: 'onion',
    householdId: 'household-1',
    reminderId: 'r1',
  });
});

it('skips an item already recorded as exported, without calling addGroceryReminder', async () => {
  mockedGetExportedItemHashes.mockResolvedValue(new Set(['onion']));

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion' })],
  });

  expect(outcome).toEqual({ succeeded: [], skipped: ['onion'], partial: [], failed: [] });
  expect(mockedAddGroceryReminder).not.toHaveBeenCalled();
  expect(mockedRecordExport).not.toHaveBeenCalled();
});

it('collects a per-item failure (create itself failed) without aborting the rest of the batch', async () => {
  mockedAddGroceryReminder
    .mockRejectedValueOnce(new Error('EventKit save failed'))
    .mockResolvedValueOnce('r2');

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion' }), item({ itemHash: 'garlic' })],
  });

  expect(outcome.succeeded).toEqual(['garlic']);
  expect(outcome.failed).toEqual([{ itemHash: 'onion', message: 'EventKit save failed' }]);
  expect(outcome.partial).toEqual([]);
  // The failed item is never recorded as exported — a later retry must
  // attempt it again.
  expect(mockedRecordExport).not.toHaveBeenCalledWith(
    DB,
    expect.objectContaining({ itemHash: 'onion' }),
  );
});

it('treats a create-succeeded-but-record-failed item as partial, never failed', async () => {
  mockedAddGroceryReminder.mockResolvedValue('r1');
  mockedRecordExport.mockRejectedValue(new Error('database is locked'));

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion' })],
  });

  expect(outcome.partial).toEqual([{ itemHash: 'onion', message: 'database is locked' }]);
  expect(outcome.failed).toEqual([]);
  expect(outcome.succeeded).toEqual([]);
  // Retried a few times before giving up — transient SQLite contention
  // is the expected real-world cause.
  expect(mockedRecordExport).toHaveBeenCalledTimes(4);
}, 10000);

it('succeeds if recordExport recovers within the retry window', async () => {
  mockedAddGroceryReminder.mockResolvedValue('r1');
  mockedRecordExport
    .mockRejectedValueOnce(new Error('database is locked'))
    .mockResolvedValueOnce(undefined);

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion' })],
  });

  expect(outcome.succeeded).toEqual(['onion']);
  expect(outcome.partial).toEqual([]);
  expect(mockedRecordExport).toHaveBeenCalledTimes(2);
});

it("never leaks an item's display text into a failure message", async () => {
  mockedAddGroceryReminder.mockRejectedValue(new Error('EventKit save failed'));

  const outcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items: [item({ itemHash: 'onion', displayText: '3 yellow onions, diced' })],
  });

  expect(outcome.failed[0]!.message).not.toContain('onion');
});

it('reports progress after each item', async () => {
  mockedAddGroceryReminder.mockResolvedValue('r1');
  const onProgress = jest.fn();

  await exportGroceriesToReminders(
    DB,
    {
      weeklyPlanId: 'plan-1',
      householdId: 'household-1',
      items: [item({ itemHash: 'onion' }), item({ itemHash: 'garlic' })],
    },
    onProgress,
  );

  expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
  expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
});

it('retrying after a partial failure only re-attempts what did not already succeed', async () => {
  // First call: onion fails, garlic succeeds.
  mockedAddGroceryReminder
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce('r-garlic');
  const items = [item({ itemHash: 'onion' }), item({ itemHash: 'garlic' })];
  await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items,
  });

  // Retry: getExportedItemHashes now reflects garlic's success.
  jest.clearAllMocks();
  mockedGetOwnedGroceryListId.mockResolvedValue('list-1');
  mockedGetExportedItemHashes.mockResolvedValue(new Set(['garlic']));
  mockedRecordExport.mockResolvedValue(undefined);
  mockedAddGroceryReminder.mockResolvedValueOnce('r-onion');

  const retryOutcome = await exportGroceriesToReminders(DB, {
    weeklyPlanId: 'plan-1',
    householdId: 'household-1',
    items,
  });

  expect(retryOutcome).toEqual({
    succeeded: ['onion'],
    skipped: ['garlic'],
    partial: [],
    failed: [],
  });
  expect(mockedAddGroceryReminder).toHaveBeenCalledTimes(1);
  expect(mockedAddGroceryReminder).toHaveBeenCalledWith('list-1', '1 onion');
});
