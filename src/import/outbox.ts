import type { SharedImport } from '../appGroup/appGroupHandoff';

/**
 * The subset of SQLiteDatabase these functions need, so tests can pass a
 * plain mock — same pattern as database.ts's MigratableDatabase and
 * sync/local.ts's LocalDb.
 */
export interface LocalDb {
  getAllAsync<T>(source: string, ...params: unknown[]): Promise<T[]>;
  runAsync(source: string, ...params: unknown[]): Promise<unknown>;
}

export type OutboxStatus = 'pending' | 'submitting' | 'submitted' | 'failed';

export interface OutboxItem {
  id: string;
  url: string;
  receivedAt: string;
  status: OutboxStatus;
  serverJobId: string | null;
  errorMessage: string | null;
  householdId: string | null;
}

interface OutboxRow {
  id: string;
  url: string;
  received_at: string;
  status: OutboxStatus;
  server_job_id: string | null;
  error_message: string | null;
  household_id: string | null;
}

function fromRow(row: OutboxRow): OutboxItem {
  return {
    id: row.id,
    url: row.url,
    receivedAt: row.received_at,
    status: row.status,
    serverJobId: row.server_job_id,
    errorMessage: row.error_message,
    householdId: row.household_id,
  };
}

/**
 * Inserts a share captured by the Share Extension, unless it's already
 * present. The App Group drain can see the same file more than once if
 * the app is killed after this commits but before the source file is
 * deleted — on conflict do nothing makes seeing it again safe, which is
 * exactly what makes that commit-before-delete ordering safe
 * (durable-import-submission.md decision 2).
 *
 * ADR-0020 (Phase 11.5): householdId is whatever household (if any) is
 * currently signed in at drain time — null when captured/drained while
 * signed out, which is the common, expected case for a Share-Extension
 * capture (ADR-0016 decision 1: it must survive until sign-in). A null
 * household_id keeps today's behavior unchanged (submits under
 * whichever household signs in next); a stamped one is what lets
 * submitPendingOutboxItems refuse to submit it under a *different*
 * household later (a device signed into household A, then B).
 */
export async function insertOutboxItemIfNew(
  db: LocalDb,
  share: SharedImport,
  householdId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `insert into import_outbox (id, url, received_at, status, household_id, created_at, updated_at)
     values (?, ?, ?, 'pending', ?, ?, ?)
     on conflict (id) do nothing`,
    share.id,
    share.url,
    new Date(share.receivedAt).toISOString(),
    householdId,
    now,
    now,
  );
}

/**
 * Rows ready for a submission attempt: freshly drained ('pending') or
 * left mid-flight by an app kill during a previous attempt
 * ('submitting') — retrying the latter reuses the same id as the
 * server-side idempotency key, so a request the server actually
 * received isn't double-submitted. 'failed' rows are deliberately
 * excluded: a definitive negative answer from the server is terminal
 * for this automatic engine, not silently retried forever. Oldest
 * first, so a backlog drains in the order it was captured.
 *
 * ADR-0020: also excludes any row already stamped with a *different*
 * household_id than the caller's — a share captured/drained under one
 * household must never auto-submit under a different one that later
 * signs in on the same device. An unstamped (null) row is untouched by
 * this filter, preserving the existing "submits under whichever
 * household signs in next" behavior for a genuinely signed-out capture.
 */
export async function listSubmittableOutboxItems(
  db: LocalDb,
  householdId: string,
): Promise<OutboxItem[]> {
  const rows = await db.getAllAsync<OutboxRow>(
    `select id, url, received_at, status, server_job_id, error_message, household_id
     from import_outbox
     where status in ('pending', 'submitting')
       and (household_id is null or household_id = ?)
     order by received_at asc`,
    householdId,
  );
  return rows.map(fromRow);
}

export async function markOutboxItemSubmitting(db: LocalDb, id: string): Promise<void> {
  await db.runAsync(
    `update import_outbox set status = 'submitting', updated_at = ? where id = ?`,
    new Date().toISOString(),
    id,
  );
}

// Reverts a 'submitting' row back to 'pending' — used when the reason a
// submission attempt didn't complete is a household-level rate limit
// rather than a real outcome, so the next foreground/reconnect attempt
// retries it instead of it being stuck mid-flight or, worse, marked
// permanently failed for a reason that has nothing to do with this
// particular import.
export async function markOutboxItemPending(db: LocalDb, id: string): Promise<void> {
  await db.runAsync(
    `update import_outbox set status = 'pending', updated_at = ? where id = ?`,
    new Date().toISOString(),
    id,
  );
}

export async function markOutboxItemSubmitted(
  db: LocalDb,
  id: string,
  serverJobId: string,
): Promise<void> {
  await db.runAsync(
    `update import_outbox set status = 'submitted', server_job_id = ?, updated_at = ? where id = ?`,
    serverJobId,
    new Date().toISOString(),
    id,
  );
}

export async function markOutboxItemFailed(
  db: LocalDb,
  id: string,
  errorMessage: string,
): Promise<void> {
  await db.runAsync(
    `update import_outbox set status = 'failed', error_message = ?, updated_at = ? where id = ?`,
    errorMessage,
    new Date().toISOString(),
    id,
  );
}
