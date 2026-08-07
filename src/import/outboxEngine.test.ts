import {
  drainAppGroupQueueIntoOutbox,
  submitPendingOutboxItems,
  summarizeOutboxOutcomes,
} from './outboxEngine';
import { deleteQueuedShare, readQueuedShares } from '../appGroup/appGroupHandoff';
import { getDatabase } from '../db/database';
import { logError, trackEvent } from '../observability';
import { submitImportJob } from './api';
import {
  insertOutboxItemIfNew,
  listSubmittableOutboxItems,
  markOutboxItemFailed,
  markOutboxItemPending,
  markOutboxItemSubmitted,
  markOutboxItemSubmitting,
} from './outbox';

jest.mock('../appGroup/appGroupHandoff', () => ({
  readQueuedShares: jest.fn(),
  deleteQueuedShare: jest.fn(),
}));
jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn(), trackEvent: jest.fn() }));
jest.mock('./api', () => ({ submitImportJob: jest.fn() }));
jest.mock('./outbox', () => ({
  insertOutboxItemIfNew: jest.fn(),
  listSubmittableOutboxItems: jest.fn(),
  markOutboxItemSubmitting: jest.fn(),
  markOutboxItemPending: jest.fn(),
  markOutboxItemSubmitted: jest.fn(),
  markOutboxItemFailed: jest.fn(),
}));

const mockedReadQueuedShares = readQueuedShares as jest.Mock;
const mockedDeleteQueuedShare = deleteQueuedShare as jest.Mock;
const mockedGetDatabase = getDatabase as jest.Mock;
const mockedSubmitImportJob = submitImportJob as jest.Mock;
const mockedInsertOutboxItemIfNew = insertOutboxItemIfNew as jest.Mock;
const mockedListSubmittableOutboxItems = listSubmittableOutboxItems as jest.Mock;
const mockedMarkSubmitting = markOutboxItemSubmitting as jest.Mock;
const mockedMarkPending = markOutboxItemPending as jest.Mock;
const mockedMarkSubmitted = markOutboxItemSubmitted as jest.Mock;
const mockedMarkFailed = markOutboxItemFailed as jest.Mock;
const mockedTrackEvent = trackEvent as jest.Mock;

const fakeDb = { fake: 'db' };
const HOUSEHOLD_ID = 'hh1';

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue(fakeDb);
});

describe('drainAppGroupQueueIntoOutbox', () => {
  it('does nothing when the queue is empty, without opening the database', async () => {
    mockedReadQueuedShares.mockReturnValue([]);

    await drainAppGroupQueueIntoOutbox(HOUSEHOLD_ID);

    expect(mockedGetDatabase).not.toHaveBeenCalled();
  });

  it('inserts each queued share, then deletes its App Group file only after the insert commits', async () => {
    const share = { id: 's1', url: 'https://example.com', receivedAt: 1 };
    mockedReadQueuedShares.mockReturnValue([share]);
    const callOrder: string[] = [];
    mockedInsertOutboxItemIfNew.mockImplementation(async () => {
      callOrder.push('insert');
    });
    mockedDeleteQueuedShare.mockImplementation(() => {
      callOrder.push('delete');
      return true;
    });

    await drainAppGroupQueueIntoOutbox(HOUSEHOLD_ID);

    expect(mockedInsertOutboxItemIfNew).toHaveBeenCalledWith(fakeDb, share, HOUSEHOLD_ID);
    expect(mockedDeleteQueuedShare).toHaveBeenCalledWith('s1');
    expect(callOrder).toEqual(['insert', 'delete']);
  });

  it('stamps a null household_id when draining while signed out (ADR-0020)', async () => {
    const share = { id: 's1', url: 'https://example.com', receivedAt: 1 };
    mockedReadQueuedShares.mockReturnValue([share]);

    await drainAppGroupQueueIntoOutbox(null);

    expect(mockedInsertOutboxItemIfNew).toHaveBeenCalledWith(fakeDb, share, null);
  });

  it('emits a count-only telemetry event, never a URL', async () => {
    mockedReadQueuedShares.mockReturnValue([
      { id: 's1', url: 'https://secret.example.com/a', receivedAt: 1 },
      { id: 's2', url: 'https://secret.example.com/b', receivedAt: 2 },
    ]);

    await drainAppGroupQueueIntoOutbox(HOUSEHOLD_ID);

    expect(mockedTrackEvent).toHaveBeenCalledWith('share_extension_drained', { count: 2 });
    for (const call of mockedTrackEvent.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('secret.example.com');
    }
  });

  it('leaves the App Group file in place when the local insert fails, so the next drain retries it', async () => {
    mockedReadQueuedShares.mockReturnValue([
      { id: 's1', url: 'https://example.com', receivedAt: 1 },
    ]);
    mockedInsertOutboxItemIfNew.mockRejectedValue(new Error('disk full'));

    await drainAppGroupQueueIntoOutbox(HOUSEHOLD_ID);

    expect(mockedDeleteQueuedShare).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it('keeps draining the rest of the queue after one share fails to insert', async () => {
    mockedReadQueuedShares.mockReturnValue([
      { id: 's1', url: 'https://example.com/a', receivedAt: 1 },
      { id: 's2', url: 'https://example.com/b', receivedAt: 2 },
    ]);
    mockedInsertOutboxItemIfNew
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);

    await drainAppGroupQueueIntoOutbox(HOUSEHOLD_ID);

    expect(mockedDeleteQueuedShare).toHaveBeenCalledTimes(1);
    expect(mockedDeleteQueuedShare).toHaveBeenCalledWith('s2');
  });
});

describe('submitPendingOutboxItems', () => {
  it('submits each pending item using its own id as the idempotency key, and records the resulting job id', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/soup', status: 'pending' },
    ]);
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'job-1', recipeId: 'r1', duplicate: false });

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedMarkSubmitting).toHaveBeenCalledWith(fakeDb, 'o1');
    expect(mockedSubmitImportJob).toHaveBeenCalledWith({
      url: 'https://example.com/soup',
      clientImportId: 'o1',
    });
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o1', 'job-1');
  });

  it("passes the caller's household id through to the submittable-items query (ADR-0020)", async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([]);

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedListSubmittableOutboxItems).toHaveBeenCalledWith(fakeDb, HOUSEHOLD_ID);
  });

  it('marks a definitive failure as failed, not retried automatically', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/soup', status: 'pending' },
    ]);
    mockedSubmitImportJob.mockRejectedValue(new Error('Could not find enough recipe content'));

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedMarkFailed).toHaveBeenCalledWith(
      fakeDb,
      'o1',
      'Could not find enough recipe content',
    );
    expect(mockedMarkPending).not.toHaveBeenCalled();
  });

  it.each([
    'please wait before importing another recipe',
    'too many imports for this household in the last hour',
    'import already in progress for this request',
  ])(
    'treats a retry-later outcome ("%s") as retry-later, not a failure, and stops the run',
    async (message) => {
      mockedListSubmittableOutboxItems.mockResolvedValue([
        { id: 'o1', url: 'https://example.com/soup', status: 'pending' },
        { id: 'o2', url: 'https://example.com/stew', status: 'pending' },
      ]);
      mockedSubmitImportJob.mockRejectedValue(new Error(message));

      await submitPendingOutboxItems(HOUSEHOLD_ID);

      expect(mockedMarkPending).toHaveBeenCalledWith(fakeDb, 'o1');
      expect(mockedMarkFailed).not.toHaveBeenCalled();
      // the second item is never even attempted — it would hit the same guard
      expect(mockedSubmitImportJob).toHaveBeenCalledTimes(1);
    },
  );

  it('processes multiple items in order when each succeeds', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending' },
      { id: 'o2', url: 'https://example.com/b', status: 'submitting' },
    ]);
    mockedSubmitImportJob
      .mockResolvedValueOnce({ jobId: 'job-1', duplicate: false })
      .mockResolvedValueOnce({ jobId: 'job-2', duplicate: false });

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedSubmitImportJob).toHaveBeenNthCalledWith(1, {
      url: 'https://example.com/a',
      clientImportId: 'o1',
    });
    expect(mockedSubmitImportJob).toHaveBeenNthCalledWith(2, {
      url: 'https://example.com/b',
      clientImportId: 'o2',
    });
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o1', 'job-1');
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o2', 'job-2');
  });

  it('marks a share older than 30 days as failed/expired without attempting submission ("Staging data expires")', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending', receivedAt: thirtyOneDaysAgo },
    ]);

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedSubmitImportJob).not.toHaveBeenCalled();
    expect(mockedMarkSubmitting).not.toHaveBeenCalled();
    expect(mockedMarkFailed).toHaveBeenCalledWith(
      fakeDb,
      'o1',
      'This import was never completed and has expired.',
    );
  });

  it('still attempts submission for a share within the expiry window', async () => {
    const twentyNineDaysAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending', receivedAt: twentyNineDaysAgo },
    ]);
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'job-1', duplicate: false });

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedSubmitImportJob).toHaveBeenCalledWith({
      url: 'https://example.com/a',
      clientImportId: 'o1',
    });
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o1', 'job-1');
  });

  it('checks each item for expiry independently, still processing non-expired ones after an expired one', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending', receivedAt: thirtyOneDaysAgo },
      { id: 'o2', url: 'https://example.com/b', status: 'pending', receivedAt: now },
    ]);
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'job-2', duplicate: false });

    await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(mockedMarkFailed).toHaveBeenCalledWith(
      fakeDb,
      'o1',
      'This import was never completed and has expired.',
    );
    expect(mockedSubmitImportJob).toHaveBeenCalledWith({
      url: 'https://example.com/b',
      clientImportId: 'o2',
    });
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o2', 'job-2');
  });

  it('returns an outcome per item attempted, so a caller can surface what happened', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending' },
      { id: 'o2', url: 'https://example.com/b', status: 'pending' },
    ]);
    mockedSubmitImportJob
      .mockResolvedValueOnce({ jobId: 'job-1', recipeId: 'r1', duplicate: false })
      .mockRejectedValueOnce(new Error('Could not fetch the page'));

    const outcomes = await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(outcomes).toEqual([
      { id: 'o1', status: 'submitted', recipeId: 'r1', duplicate: false },
      { id: 'o2', status: 'failed', errorMessage: 'Could not fetch the page' },
    ]);
  });

  it('returns only the outcomes attempted before a rate-limit guard stopped the run', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending' },
      { id: 'o2', url: 'https://example.com/b', status: 'pending' },
    ]);
    mockedSubmitImportJob
      .mockResolvedValueOnce({ jobId: 'job-1', duplicate: false })
      .mockRejectedValueOnce(new Error('please wait before importing another recipe'));

    const outcomes = await submitPendingOutboxItems(HOUSEHOLD_ID);

    expect(outcomes).toEqual([
      { id: 'o1', status: 'submitted', recipeId: undefined, duplicate: false },
    ]);
  });

  it('stops the run if the current household changes mid-drain, submitting nothing under the new one (ADR-0020, Codex review PR #33)', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending' },
      { id: 'o2', url: 'https://example.com/b', status: 'pending' },
    ]);
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'job-1', duplicate: false });
    // Simulates a sign-out/sign-in racing the drain: the live getter
    // reports a different household than the one this run started with.
    const getCurrentHouseholdId = jest.fn(() => 'a-different-household');

    const outcomes = await submitPendingOutboxItems(HOUSEHOLD_ID, getCurrentHouseholdId);

    expect(outcomes).toEqual([]);
    expect(mockedSubmitImportJob).not.toHaveBeenCalled();
  });

  it('keeps submitting while the current household still matches the one this run started with', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/a', status: 'pending' },
    ]);
    mockedSubmitImportJob.mockResolvedValue({ jobId: 'job-1', duplicate: false });
    const getCurrentHouseholdId = jest.fn(() => HOUSEHOLD_ID);

    const outcomes = await submitPendingOutboxItems(HOUSEHOLD_ID, getCurrentHouseholdId);

    expect(outcomes).toEqual([
      { id: 'o1', status: 'submitted', recipeId: undefined, duplicate: false },
    ]);
    expect(getCurrentHouseholdId).toHaveBeenCalled();
  });
});

describe('summarizeOutboxOutcomes', () => {
  it('returns null for no outcomes (nothing to tell the user)', () => {
    expect(summarizeOutboxOutcomes([])).toBeNull();
  });

  it('describes a single fresh import', () => {
    expect(summarizeOutboxOutcomes([{ id: 'o1', status: 'submitted', duplicate: false }])).toBe(
      'Recipe imported from Share',
    );
  });

  it('describes a single duplicate distinctly', () => {
    expect(summarizeOutboxOutcomes([{ id: 'o1', status: 'submitted', duplicate: true }])).toBe(
      'Already in your library',
    );
  });

  it('describes a single failure', () => {
    expect(summarizeOutboxOutcomes([{ id: 'o1', status: 'failed', errorMessage: 'boom' }])).toBe(
      "Couldn't import a recipe you shared",
    );
  });

  it('summarizes multiple successes as a count', () => {
    expect(
      summarizeOutboxOutcomes([
        { id: 'o1', status: 'submitted', duplicate: false },
        { id: 'o2', status: 'submitted', duplicate: false },
      ]),
    ).toBe('2 recipes imported from Share');
  });

  it('summarizes multiple failures as a count', () => {
    expect(
      summarizeOutboxOutcomes([
        { id: 'o1', status: 'failed' },
        { id: 'o2', status: 'failed' },
      ]),
    ).toBe("Couldn't import 2 shared recipes");
  });

  it('summarizes a mix of successes and failures', () => {
    expect(
      summarizeOutboxOutcomes([
        { id: 'o1', status: 'submitted', duplicate: false },
        { id: 'o2', status: 'failed' },
      ]),
    ).toBe('1 imported, 1 failed');
  });
});
