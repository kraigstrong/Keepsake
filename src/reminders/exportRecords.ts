import type { LocalDb } from '../sync/local';

/**
 * Local (not Supabase) bookkeeping for which grocery items have already
 * been exported to Reminders, per (weekly_plan_id, item_hash) — see
 * ADR-0023. This is the sole idempotency mechanism for exportGroceries.ts:
 * an item already recorded here is skipped, never re-created.
 */

interface ExportedHashRow {
  item_hash: string;
}

export async function getExportedItemHashes(
  db: LocalDb,
  weeklyPlanId: string,
): Promise<Set<string>> {
  const rows = await db.getAllAsync<ExportedHashRow>(
    'select item_hash from grocery_exports where weekly_plan_id = ?',
    weeklyPlanId,
  );
  return new Set(rows.map((row) => row.item_hash));
}

export interface RecordExportParams {
  weeklyPlanId: string;
  itemHash: string;
  householdId: string;
  reminderId: string;
}

// on conflict do update (not "do nothing"): a retry after a partial
// success should never happen for an already-succeeded item — the
// caller checks getExportedItemHashes first — but if it somehow did,
// overwriting with the latest reminderId/exported_at is more correct
// than silently keeping a stale one.
export async function recordExport(db: LocalDb, params: RecordExportParams): Promise<void> {
  await db.runAsync(
    `insert into grocery_exports (weekly_plan_id, item_hash, household_id, reminder_id, exported_at)
     values (?, ?, ?, ?, ?)
     on conflict (weekly_plan_id, item_hash) do update set
       reminder_id = excluded.reminder_id,
       exported_at = excluded.exported_at`,
    params.weeklyPlanId,
    params.itemHash,
    params.householdId,
    params.reminderId,
    new Date().toISOString(),
  );
}
