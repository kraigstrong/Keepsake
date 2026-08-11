import {
  enqueueCookingEvent,
  listSubmittableCookingEventOutboxItems,
  markCookingEventOutboxItemFailed,
  markCookingEventOutboxItemSubmitting,
  removeCookingEventOutboxItem,
  type LocalDb,
} from './outbox';

function createMockDb(
  overrides: Record<string, jest.Mock> = {},
): LocalDb & { runAsync: jest.Mock; getAllAsync: jest.Mock } {
  return {
    getAllAsync: jest.fn(async () => []),
    runAsync: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as LocalDb & { runAsync: jest.Mock; getAllAsync: jest.Mock };
}

const HOUSEHOLD_ID = 'hh1';
const RECIPE_ID = 'recipe1';

describe('enqueueCookingEvent', () => {
  it('inserts a pending row with a generated id and returns it', async () => {
    const db = createMockDb();

    const item = await enqueueCookingEvent(
      db,
      RECIPE_ID,
      HOUSEHOLD_ID,
      '2026-08-10T18:00:00.000Z',
      'Great.',
    );

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into cooking_event_outbox'),
      item.id,
      RECIPE_ID,
      HOUSEHOLD_ID,
      '2026-08-10T18:00:00.000Z',
      'Great.',
      expect.any(String),
    );
    expect(item).toEqual({
      id: expect.any(String),
      recipeId: RECIPE_ID,
      householdId: HOUSEHOLD_ID,
      cookedAt: '2026-08-10T18:00:00.000Z',
      note: 'Great.',
      status: 'pending',
      errorMessage: null,
      createdAt: expect.any(String),
    });
  });

  it('accepts a null note', async () => {
    const db = createMockDb();
    const item = await enqueueCookingEvent(
      db,
      RECIPE_ID,
      HOUSEHOLD_ID,
      '2026-08-10T18:00:00.000Z',
      null,
    );
    expect(item.note).toBeNull();
  });
});

describe('listSubmittableCookingEventOutboxItems', () => {
  it('queries only pending and submitting rows owned by the caller, oldest first', async () => {
    const db = createMockDb();
    await listSubmittableCookingEventOutboxItems(db, HOUSEHOLD_ID);

    const query = db.getAllAsync.mock.calls[0][0] as string;
    expect(query).toContain("status in ('pending', 'submitting')");
    expect(query).toContain('household_id = ?');
    expect(query).toContain('order by created_at asc');
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.any(String), HOUSEHOLD_ID);
  });

  it('maps rows from snake_case columns to the CookingEventOutboxItem shape', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        {
          id: '1',
          recipe_id: RECIPE_ID,
          household_id: HOUSEHOLD_ID,
          cooked_at: '2026-08-10T18:00:00.000Z',
          note: null,
          status: 'pending' as const,
          error_message: null,
          created_at: '2026-08-10T18:00:00.000Z',
        },
      ]),
    });

    await expect(listSubmittableCookingEventOutboxItems(db, HOUSEHOLD_ID)).resolves.toEqual([
      {
        id: '1',
        recipeId: RECIPE_ID,
        householdId: HOUSEHOLD_ID,
        cookedAt: '2026-08-10T18:00:00.000Z',
        note: null,
        status: 'pending',
        errorMessage: null,
        createdAt: '2026-08-10T18:00:00.000Z',
      },
    ]);
  });
});

describe('status transitions', () => {
  it('markCookingEventOutboxItemSubmitting sets status to submitting', async () => {
    const db = createMockDb();
    await markCookingEventOutboxItemSubmitting(db, '1');
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining("status = 'submitting'"), '1');
  });

  it('markCookingEventOutboxItemFailed records the error message', async () => {
    const db = createMockDb();
    await markCookingEventOutboxItemFailed(db, '1', 'boom');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      'boom',
      '1',
    );
  });

  it('removeCookingEventOutboxItem deletes the row', async () => {
    const db = createMockDb();
    await removeCookingEventOutboxItem(db, '1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('delete from cooking_event_outbox'),
      '1',
    );
  });
});
