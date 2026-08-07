import {
  insertOutboxItemIfNew,
  listSubmittableOutboxItems,
  markOutboxItemFailed,
  markOutboxItemPending,
  markOutboxItemSubmitted,
  markOutboxItemSubmitting,
  type LocalDb,
} from './outbox';
import type { SharedImport } from '../appGroup/appGroupHandoff';

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

const share: SharedImport = {
  id: '11111111-1111-1111-1111-111111111111',
  url: 'https://example.com/recipe',
  receivedAt: 1785600000000,
};

describe('insertOutboxItemIfNew', () => {
  it('inserts the share as a pending row, keyed by its id, stamped with the current household', async () => {
    const db = createMockDb();

    await insertOutboxItemIfNew(db, share, HOUSEHOLD_ID);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into import_outbox'),
      share.id,
      share.url,
      new Date(share.receivedAt).toISOString(),
      HOUSEHOLD_ID,
      expect.any(String),
      expect.any(String),
    );
    expect(db.runAsync.mock.calls[0][0]).toContain('on conflict (id) do nothing');
  });

  it('stamps a null household_id when captured while signed out (ADR-0020)', async () => {
    const db = createMockDb();

    await insertOutboxItemIfNew(db, share, null);

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into import_outbox'),
      share.id,
      share.url,
      new Date(share.receivedAt).toISOString(),
      null,
      expect.any(String),
      expect.any(String),
    );
  });
});

describe('listSubmittableOutboxItems', () => {
  it('queries only pending and submitting rows, unowned or owned by the caller, oldest first', async () => {
    const db = createMockDb();
    await listSubmittableOutboxItems(db, HOUSEHOLD_ID);

    const query = db.getAllAsync.mock.calls[0][0] as string;
    expect(query).toContain("status in ('pending', 'submitting')");
    expect(query).toContain('household_id is null or household_id = ?');
    expect(query).toContain('order by received_at asc');
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.any(String), HOUSEHOLD_ID);
  });

  it('maps rows from snake_case columns to the OutboxItem shape', async () => {
    const db = createMockDb({
      getAllAsync: jest.fn(async () => [
        {
          id: '1',
          url: 'https://example.com',
          received_at: '2026-08-05T00:00:00.000Z',
          status: 'pending' as const,
          server_job_id: null,
          error_message: null,
          household_id: HOUSEHOLD_ID,
        },
      ]),
    });

    await expect(listSubmittableOutboxItems(db, HOUSEHOLD_ID)).resolves.toEqual([
      {
        id: '1',
        url: 'https://example.com',
        receivedAt: '2026-08-05T00:00:00.000Z',
        status: 'pending',
        serverJobId: null,
        errorMessage: null,
        householdId: HOUSEHOLD_ID,
      },
    ]);
  });
});

describe('status transitions', () => {
  it('markOutboxItemSubmitting sets status to submitting', async () => {
    const db = createMockDb();
    await markOutboxItemSubmitting(db, '1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'submitting'"),
      expect.any(String),
      '1',
    );
  });

  it('markOutboxItemPending sets status back to pending', async () => {
    const db = createMockDb();
    await markOutboxItemPending(db, '1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      expect.any(String),
      '1',
    );
  });

  it('markOutboxItemSubmitted records the server job id', async () => {
    const db = createMockDb();
    await markOutboxItemSubmitted(db, '1', 'job-1');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'submitted'"),
      'job-1',
      expect.any(String),
      '1',
    );
  });

  it('markOutboxItemFailed records the error message', async () => {
    const db = createMockDb();
    await markOutboxItemFailed(db, '1', 'boom');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      'boom',
      expect.any(String),
      '1',
    );
  });
});
