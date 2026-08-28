import { addGroceryReminder, getActiveReminderIds, getOwnedGroceryListId } from './reminders';
import { getExportedItems, recordExport } from './exportRecords';
import { trackEvent } from '../observability';
import type { LocalDb } from '../sync/local';

/**
 * Exports a household's reviewed grocery items to the app's Reminders
 * list (ADR-0023). Sequential, not parallel — a native EventKit write
 * per item, and per-item outcomes need to stay individually attributable
 * for the result summary. Duplicate protection means retry is simply
 * calling this again: an item already recorded as exported is skipped
 * *only while its reminder is still open in Reminders* (ADR-0023
 * amended, 2026-08-08) — a plan is a singleton per (household,
 * week_key), reused as it gets replanned, so a recorded row can easily
 * outlive the shopping trip it was created for. Once the user checks
 * that reminder off (or deletes it), the same item_hash showing up in a
 * later export is a *new* grocery list, not a retry, and gets recreated.
 */

export interface GroceryExportItem {
  itemHash: string;
  displayText: string;
}

export interface GroceryExportFailure {
  itemHash: string;
  message: string;
}

export interface GroceryExportOutcome {
  succeeded: string[];
  skipped: string[];
  // A reminder was created in the real Reminders app, but the local
  // record of that couldn't be written after several attempts (Codex
  // review, PR #46) — never retried, unlike `failed`: since the item
  // genuinely exists in Reminders now, re-attempting `addGroceryReminder`
  // for it on a retry would create a real, user-visible duplicate.
  partial: GroceryExportFailure[];
  failed: GroceryExportFailure[];
}

export interface ExportGroceriesParams {
  weeklyPlanId: string;
  householdId: string;
  items: readonly GroceryExportItem[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SQLite write contention is normally transient (a brief lock held by
// another connection), so a short retry loop resolves the overwhelming
// majority of cases without needing anything more elaborate — the
// alternative (giving up immediately) is what creates the "reminder
// exists, but we don't know it" gap in the first place.
const RECORD_EXPORT_RETRY_DELAYS_MS = [50, 150, 400];

async function recordExportWithRetry(
  db: LocalDb,
  params: Parameters<typeof recordExport>[1],
): Promise<{ ok: true } | { ok: false; message: string }> {
  let lastMessage = 'Unknown error';
  for (let attempt = 0; attempt <= RECORD_EXPORT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await recordExport(db, params);
      return { ok: true };
    } catch (error) {
      lastMessage = errorMessage(error);
      const retryDelay = RECORD_EXPORT_RETRY_DELAYS_MS[attempt];
      if (retryDelay !== undefined) {
        await delay(retryDelay);
      }
    }
  }
  return { ok: false, message: lastMessage };
}

export async function exportGroceriesToReminders(
  db: LocalDb,
  params: ExportGroceriesParams,
  onProgress?: (completed: number, total: number) => void,
): Promise<GroceryExportOutcome> {
  const exportedItems = await getExportedItems(db, params.weeklyPlanId);
  const listId = await getOwnedGroceryListId();
  const activeReminderIds = await getActiveReminderIds(listId);

  const outcome: GroceryExportOutcome = { succeeded: [], skipped: [], partial: [], failed: [] };

  let completed = 0;
  for (const item of params.items) {
    const recordedReminderId = exportedItems.get(item.itemHash);
    if (recordedReminderId !== undefined && activeReminderIds.has(recordedReminderId)) {
      outcome.skipped.push(item.itemHash);
      completed += 1;
      onProgress?.(completed, params.items.length);
      continue;
    }

    let reminderId: string;
    try {
      reminderId = await addGroceryReminder(listId, item.displayText);
    } catch (error) {
      // Never the item's own text (ADR-0023, "no reminder content in
      // logs") — only its identity hash and whatever generic message
      // the native call surfaced.
      outcome.failed.push({ itemHash: item.itemHash, message: errorMessage(error) });
      completed += 1;
      onProgress?.(completed, params.items.length);
      continue;
    }

    const recorded = await recordExportWithRetry(db, {
      weeklyPlanId: params.weeklyPlanId,
      itemHash: item.itemHash,
      householdId: params.householdId,
      reminderId,
    });
    if (recorded.ok) {
      outcome.succeeded.push(item.itemHash);
    } else {
      outcome.partial.push({ itemHash: item.itemHash, message: recorded.message });
    }

    completed += 1;
    onProgress?.(completed, params.items.length);
  }

  // All four buckets, because a partial export is the interesting case
  // and reporting only successes would hide it. skipped is expected
  // (already-exported items), not a failure.
  trackEvent('grocery_list_exported', {
    succeeded: outcome.succeeded.length,
    skipped: outcome.skipped.length,
    partial: outcome.partial.length,
    failed: outcome.failed.length,
  });

  return outcome;
}
