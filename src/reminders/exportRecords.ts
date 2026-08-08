import type { LocalDb } from '../sync/local';

/**
 * Local (not Supabase) bookkeeping for which grocery items have already
 * been exported to Reminders, per (weekly_plan_id, item_hash) — see
 * ADR-0023, amended per developer device-testing feedback 2026-08-08.
 * A row here is no longer an unconditional "skip forever": a plan is a
 * singleton per (household, week_key) and gets edited/replanned in
 * place, so a stale row can point at a reminder the user has since
 * completed or deleted while shopping. exportGroceries.ts treats this
 * map as a *candidate* to skip, valid only for as long as the recorded
 * `reminder_id` is still open in Reminders itself (checked via
 * `getActiveReminderIds`) — this module has no way to know that on its
 * own, since it never touches EventKit.
 */

interface ExportedItemRow {
  item_hash: string;
  reminder_id: string;
}

export async function getExportedItems(
  db: LocalDb,
  weeklyPlanId: string,
): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<ExportedItemRow>(
    'select item_hash, reminder_id from grocery_exports where weekly_plan_id = ?',
    weeklyPlanId,
  );
  return new Map(rows.map((row) => [row.item_hash, row.reminder_id]));
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
