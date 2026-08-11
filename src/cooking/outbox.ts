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

export type CookingEventOutboxStatus = 'pending' | 'submitting';

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
 * Every row not currently mid-flight is submittable — 'pending' (freshly
 * queued, or a previous attempt that failed and was returned here by
 * recordCookingEventOutboxFailure below) and 'submitting' (left mid-
 * flight by an app kill during a previous attempt; retrying it reuses
 * the same id as record_cooking_event()'s idempotency key, so a request
 * the server actually received isn't double-recorded). Oldest first.
 *
 * Unlike import_outbox, there's no permanent-failure/retry-later
 * distinction here (import has RETRY_LATER_MESSAGES for known rate-limit
 * outcomes; nothing analogous exists for cooking events) — every failure
 * is treated as retry-later, indefinitely, on the next foreground/
 * reconnect drain. A stuck row (e.g. a household-ownership mismatch that
 * can never resolve) costs one wasted RPC call per drain, not a silently
 * lost completion — the tradeoff this app's own Phase 14 precedent
 * (explicit "Retry failed items") argues for over a "give up" terminal
 * state with no recovery path.
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

/**
 * Records why an attempt failed and returns the row to 'pending' so the
 * next drain retries it — see listSubmittableCookingEventOutboxItems's
 * own comment for why there's no separate terminal 'failed' state.
 * error_message is kept (not cleared) even across a later successful
 * retry's own row deletion — there's nothing to clean up mid-flight,
 * only a future observability surface would ever read it back.
 */
export async function recordCookingEventOutboxFailure(
  db: LocalDb,
  id: string,
  errorMessage: string,
): Promise<void> {
  await db.runAsync(
    `update cooking_event_outbox set status = 'pending', error_message = ? where id = ?`,
    errorMessage,
    id,
  );
}

export async function removeCookingEventOutboxItem(db: LocalDb, id: string): Promise<void> {
  await db.runAsync(`delete from cooking_event_outbox where id = ?`, id);
}
