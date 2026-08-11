import { randomId } from '../shared/randomId';

/**
 * Durable local queue for offline cooking completion (OFF-05, ADR-0024
 * decision 3) — copies import_outbox's shape (Phase 9, ADR-0016) rather
 * than inventing a new one. One real difference: there is no signed-out
 * capture case here (Done Cooking only happens from inside the app while
 * signed in, unlike a Share Extension capture), so household_id is
 * always known at insert time — no nullable-household-id filtering logic
 * to carry over. A submitted item is deleted outright rather than kept
 * with a 'submitted' status: once record_cooking_event() succeeds, the
 * server's cooking_events row is the source of truth and nothing in this
 * app reads back its own outbox history, so there's no reason to keep it.
 */

/** The subset of SQLiteDatabase these functions need — same pattern as
 * database.ts's MigratableDatabase and import/outbox.ts's LocalDb. */
export interface LocalDb {
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
}

export type CookingEventOutboxStatus = 'pending' | 'submitting' | 'failed';

export interface CookingEventOutboxItem {
  /** Also record_cooking_event()'s client_event_id idempotency key. */
  id: string;
  recipeId: string;
  householdId: string;
  cookedAt: string;
  note: string | null;
  status: CookingEventOutboxStatus;
  errorMessage: string | null;
  createdAt: string;
}

interface CookingEventOutboxRow {
  id: string;
  recipe_id: string;
  household_id: string;
  cooked_at: string;
  note: string | null;
  status: CookingEventOutboxStatus;
  error_message: string | null;
  created_at: string;
}

function fromRow(row: CookingEventOutboxRow): CookingEventOutboxItem {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    householdId: row.household_id,
    cookedAt: row.cooked_at,
    note: row.note,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export async function enqueueCookingEvent(
  db: LocalDb,
  recipeId: string,
  householdId: string,
  cookedAt: string,
  note: string | null,
): Promise<CookingEventOutboxItem> {
  const id = randomId();
  const createdAt = new Date().toISOString();
  await db.runAsync(
    `insert into cooking_event_outbox
       (id, recipe_id, household_id, cooked_at, note, status, created_at)
     values (?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    recipeId,
    householdId,
    cookedAt,
    note,
    createdAt,
  );
  return {
    id,
    recipeId,
    householdId,
    cookedAt,
    note,
    status: 'pending',
    errorMessage: null,
    createdAt,
  };
}

/**
 * Rows ready for a submission attempt: freshly queued ('pending') or
 * left mid-flight by an app kill during a previous attempt
 * ('submitting') — retrying the latter reuses the same id as
 * record_cooking_event()'s idempotency key, so a request the server
 * actually received isn't double-recorded. 'failed' rows are excluded,
 * same as import_outbox: a definitive negative answer is terminal for
 * this automatic engine. Oldest first.
 */
export async function listSubmittableCookingEventOutboxItems(
  db: LocalDb,
  householdId: string,
): Promise<CookingEventOutboxItem[]> {
  const rows = await db.getAllAsync<CookingEventOutboxRow>(
    `select id, recipe_id, household_id, cooked_at, note, status, error_message, created_at
     from cooking_event_outbox
     where status in ('pending', 'submitting') and household_id = ?
     order by created_at asc`,
    householdId,
  );
  return rows.map(fromRow);
}

export async function markCookingEventOutboxItemSubmitting(db: LocalDb, id: string): Promise<void> {
  await db.runAsync(`update cooking_event_outbox set status = 'submitting' where id = ?`, id);
}

export async function markCookingEventOutboxItemFailed(
  db: LocalDb,
  id: string,
  errorMessage: string,
): Promise<void> {
  await db.runAsync(
    `update cooking_event_outbox set status = 'failed', error_message = ? where id = ?`,
    errorMessage,
    id,
  );
}

export async function removeCookingEventOutboxItem(db: LocalDb, id: string): Promise<void> {
  await db.runAsync(`delete from cooking_event_outbox where id = ?`, id);
}
