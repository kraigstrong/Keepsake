import { addGroceryReminder, getOrCreateGroceryList } from './reminders';
import { getExportedItemHashes, recordExport } from './exportRecords';
import type { LocalDb } from '../sync/local';

/**
 * Exports a household's reviewed grocery items to the app's Reminders
 * list (ADR-0023). Sequential, not parallel — a native EventKit write
 * per item, and per-item outcomes need to stay individually attributable
 * for the result summary. Duplicate protection means retry is simply
 * calling this again: already-recorded items are skipped, so a second
 * call after a partial failure only attempts what didn't succeed (or
 * wasn't attempted) last time.
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
  failed: GroceryExportFailure[];
}

export interface ExportGroceriesParams {
  weeklyPlanId: string;
  householdId: string;
  items: readonly GroceryExportItem[];
}

export async function exportGroceriesToReminders(
  db: LocalDb,
  params: ExportGroceriesParams,
  onProgress?: (completed: number, total: number) => void,
): Promise<GroceryExportOutcome> {
  const alreadyExported = await getExportedItemHashes(db, params.weeklyPlanId);
  const listId = await getOrCreateGroceryList();

  const outcome: GroceryExportOutcome = { succeeded: [], skipped: [], failed: [] };

  let completed = 0;
  for (const item of params.items) {
    if (alreadyExported.has(item.itemHash)) {
      outcome.skipped.push(item.itemHash);
    } else {
      try {
        const reminderId = await addGroceryReminder(listId, item.displayText);
        await recordExport(db, {
          weeklyPlanId: params.weeklyPlanId,
          itemHash: item.itemHash,
          householdId: params.householdId,
          reminderId,
        });
        outcome.succeeded.push(item.itemHash);
      } catch (error) {
        // Never the item's own text (ADR-0023, "no reminder content in
        // logs") — only its identity hash and whatever generic message
        // the native call surfaced.
        outcome.failed.push({
          itemHash: item.itemHash,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    completed += 1;
    onProgress?.(completed, params.items.length);
  }

  return outcome;
}
