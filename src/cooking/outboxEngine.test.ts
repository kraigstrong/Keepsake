import { recordCookingEvent } from './api';
import { submitPendingCookingEvents } from './outboxEngine';
import {
  listSubmittableCookingEventOutboxItems,
  markCookingEventOutboxItemFailed,
  markCookingEventOutboxItemSubmitting,
  removeCookingEventOutboxItem,
} from './outbox';
import { getDatabase } from '../db/database';
import { logError } from '../observability';

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../observability', () => ({ logError: jest.fn() }));
jest.mock('./api', () => ({ recordCookingEvent: jest.fn() }));
jest.mock('./outbox', () => ({
  listSubmittableCookingEventOutboxItems: jest.fn(),
  markCookingEventOutboxItemSubmitting: jest.fn(),
  markCookingEventOutboxItemFailed: jest.fn(),
  removeCookingEventOutboxItem: jest.fn(),
}));

const mockedGetDatabase = getDatabase as jest.Mock;
const mockedRecordCookingEvent = recordCookingEvent as jest.Mock;
const mockedListSubmittable = listSubmittableCookingEventOutboxItems as jest.Mock;
const mockedMarkSubmitting = markCookingEventOutboxItemSubmitting as jest.Mock;
const mockedMarkFailed = markCookingEventOutboxItemFailed as jest.Mock;
const mockedRemove = removeCookingEventOutboxItem as jest.Mock;
const mockedLogError = logError as jest.Mock;

const fakeDb = { fake: 'db' };
const HOUSEHOLD_ID = 'hh1';

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetDatabase.mockResolvedValue(fakeDb);
});

describe('submitPendingCookingEvents', () => {
  it('submits each pending item using its own id as the idempotency key, then removes it from the queue', async () => {
    mockedListSubmittable.mockResolvedValue([
      {
        id: 'e1',
        recipeId: 'recipe-1',
        householdId: HOUSEHOLD_ID,
        cookedAt: '2026-08-10T18:00:00.000Z',
        note: 'Great.',
        status: 'pending',
      },
    ]);
    mockedRecordCookingEvent.mockResolvedValue(undefined);

    await submitPendingCookingEvents(HOUSEHOLD_ID);

    expect(mockedMarkSubmitting).toHaveBeenCalledWith(fakeDb, 'e1');
    expect(mockedRecordCookingEvent).toHaveBeenCalledWith({
      recipeId: 'recipe-1',
      cookedAt: '2026-08-10T18:00:00.000Z',
      note: 'Great.',
      clientEventId: 'e1',
    });
    expect(mockedRemove).toHaveBeenCalledWith(fakeDb, 'e1');
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });

  it("passes the caller's household id through to the submittable-items query", async () => {
    mockedListSubmittable.mockResolvedValue([]);
    await submitPendingCookingEvents(HOUSEHOLD_ID);
    expect(mockedListSubmittable).toHaveBeenCalledWith(fakeDb, HOUSEHOLD_ID);
  });

  it('marks a failure as failed, logs it, and leaves the row in the queue rather than removing it', async () => {
    mockedListSubmittable.mockResolvedValue([
      { id: 'e1', recipeId: 'recipe-1', householdId: HOUSEHOLD_ID, cookedAt: 'x', note: null },
    ]);
    mockedRecordCookingEvent.mockRejectedValue(new Error('recipe not found'));

    await submitPendingCookingEvents(HOUSEHOLD_ID);

    expect(mockedMarkFailed).toHaveBeenCalledWith(fakeDb, 'e1', 'recipe not found');
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(mockedLogError).toHaveBeenCalled();
  });

  it('processes multiple items in order, each independently', async () => {
    mockedListSubmittable.mockResolvedValue([
      { id: 'e1', recipeId: 'r1', householdId: HOUSEHOLD_ID, cookedAt: 'x', note: null },
      { id: 'e2', recipeId: 'r2', householdId: HOUSEHOLD_ID, cookedAt: 'y', note: null },
    ]);
    mockedRecordCookingEvent
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));

    await submitPendingCookingEvents(HOUSEHOLD_ID);

    expect(mockedRemove).toHaveBeenCalledWith(fakeDb, 'e1');
    expect(mockedMarkFailed).toHaveBeenCalledWith(fakeDb, 'e2', 'boom');
  });

  it('stops the run if the signed-in household changes mid-drain', async () => {
    mockedListSubmittable.mockResolvedValue([
      { id: 'e1', recipeId: 'r1', householdId: HOUSEHOLD_ID, cookedAt: 'x', note: null },
      { id: 'e2', recipeId: 'r2', householdId: HOUSEHOLD_ID, cookedAt: 'y', note: null },
    ]);
    mockedRecordCookingEvent.mockResolvedValue(undefined);

    await submitPendingCookingEvents(HOUSEHOLD_ID, () => 'a-different-household');

    expect(mockedRecordCookingEvent).not.toHaveBeenCalled();
  });
});
