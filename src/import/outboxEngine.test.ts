import { drainAppGroupQueueIntoOutbox, submitPendingOutboxItems } from './outboxEngine';
import { deleteQueuedShare, readQueuedShares } from '../appGroup/appGroupHandoff';
import { getDatabase } from '../db/database';
import { logError } from '../observability';
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
jest.mock('../observability', () => ({ logError: jest.fn() }));
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

const fakeDb = { fake: 'db' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue(fakeDb);
});

describe('drainAppGroupQueueIntoOutbox', () => {
  it('does nothing when the queue is empty, without opening the database', async () => {
    mockedReadQueuedShares.mockReturnValue([]);

    await drainAppGroupQueueIntoOutbox();

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

    await drainAppGroupQueueIntoOutbox();

    expect(mockedInsertOutboxItemIfNew).toHaveBeenCalledWith(fakeDb, share);
    expect(mockedDeleteQueuedShare).toHaveBeenCalledWith('s1');
    expect(callOrder).toEqual(['insert', 'delete']);
  });

  it('leaves the App Group file in place when the local insert fails, so the next drain retries it', async () => {
    mockedReadQueuedShares.mockReturnValue([
      { id: 's1', url: 'https://example.com', receivedAt: 1 },
    ]);
    mockedInsertOutboxItemIfNew.mockRejectedValue(new Error('disk full'));

    await drainAppGroupQueueIntoOutbox();

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

    await drainAppGroupQueueIntoOutbox();

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

    await submitPendingOutboxItems();

    expect(mockedMarkSubmitting).toHaveBeenCalledWith(fakeDb, 'o1');
    expect(mockedSubmitImportJob).toHaveBeenCalledWith({
      url: 'https://example.com/soup',
      clientImportId: 'o1',
    });
    expect(mockedMarkSubmitted).toHaveBeenCalledWith(fakeDb, 'o1', 'job-1');
  });

  it('marks a definitive failure as failed, not retried automatically', async () => {
    mockedListSubmittableOutboxItems.mockResolvedValue([
      { id: 'o1', url: 'https://example.com/soup', status: 'pending' },
    ]);
    mockedSubmitImportJob.mockRejectedValue(new Error('Could not find enough recipe content'));

    await submitPendingOutboxItems();

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
  ])(
    'treats a household rate limit ("%s") as retry-later, not a failure, and stops the run',
    async (message) => {
      mockedListSubmittableOutboxItems.mockResolvedValue([
        { id: 'o1', url: 'https://example.com/soup', status: 'pending' },
        { id: 'o2', url: 'https://example.com/stew', status: 'pending' },
      ]);
      mockedSubmitImportJob.mockRejectedValue(new Error(message));

      await submitPendingOutboxItems();

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

    await submitPendingOutboxItems();

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
});
