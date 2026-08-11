import { recordCookingEvent } from './api';
import {
  listSubmittableCookingEventOutboxItems,
  markCookingEventOutboxItemFailed,
  markCookingEventOutboxItemSubmitting,
  removeCookingEventOutboxItem,
} from './outbox';
import { getDatabase } from '../db/database';
import { logError } from '../observability';

/**
 * Attempts to submit every queued cooking-completion event, oldest
 * first — mirrors import/outboxEngine.ts's submitPendingOutboxItems, but
 * simpler: unlike a Share-Extension-originated import (which has no
 * screen of its own to land on), Done Cooking always has the user
 * present at the moment of completion, and the local outbox write
 * already gave them their "it worked" confirmation (ADR-0024 decision
 * 3) — there's nothing new to tell them when a delayed background sync
 * eventually succeeds, so this returns void rather than an outcome array
 * for a caller to turn into a toast.
 *
 * Callers gate this on being signed in, online, and belonging to a
 * household, same contract as the import engine. getCurrentHouseholdId
 * closes the same TOCTOU gap ADR-0020 fixed there — a fast account
 * switch mid-drain shouldn't let a later item submit under the new
 * household's session just because it was selected under the old one.
 */
export async function submitPendingCookingEvents(
  householdId: string,
  getCurrentHouseholdId: () => string | null = () => householdId,
): Promise<void> {
  const db = await getDatabase();
  const items = await listSubmittableCookingEventOutboxItems(db, householdId);

  for (const item of items) {
    if (getCurrentHouseholdId() !== householdId) break;

    await markCookingEventOutboxItemSubmitting(db, item.id);
    try {
      await recordCookingEvent({
        recipeId: item.recipeId,
        cookedAt: item.cookedAt,
        note: item.note,
        clientEventId: item.id,
      });
      await removeCookingEventOutboxItem(db, item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markCookingEventOutboxItemFailed(db, item.id, message);
      logError(error, { context: 'submitCookingEventOutboxItem' });
    }
  }
}
