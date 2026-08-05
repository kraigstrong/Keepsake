import { deleteQueuedShare, readQueuedShares } from '../appGroup/appGroupHandoff';
import { getDatabase } from '../db/database';
import { logError, trackEvent } from '../observability';
import { submitImportJob } from './api';
import {
  insertOutboxItemIfNew,
  listSubmittableOutboxItems,
  markOutboxItemFailed,
  markOutboxItemPending,
  markOutboxItemSubmitted,
  markOutboxItemSubmitting,
} from './outbox';

/**
 * Drains every share currently queued by the Share Extension into the
 * local outbox — a pure local operation, no auth or network required, so
 * it runs on every app launch/foreground regardless of sign-in state. A
 * share captured while signed out must still survive until the user
 * signs in (ADR-0016 decision 1) — it isn't gated on session state the
 * way submitPendingOutboxItems below is.
 *
 * The SQLite insert is committed before the App Group file is deleted
 * (durable-import-submission.md decision 2) — if the app is killed in
 * between, the file is still there next launch and nothing is lost;
 * insertOutboxItemIfNew's on-conflict-do-nothing makes seeing the same
 * file again safe.
 */
export async function drainAppGroupQueueIntoOutbox(): Promise<void> {
  const shares = readQueuedShares();
  if (shares.length === 0) return;

  const db = await getDatabase();
  for (const share of shares) {
    try {
      await insertOutboxItemIfNew(db, share);
      deleteQueuedShare(share.id);
    } catch (error) {
      logError(error, { context: 'drainAppGroupQueue' });
      // leave the App Group file in place — retried on the next drain
    }
  }

  // Count only — never a URL — same rule import_completed/import_failed
  // already follow (prd.md §30). This is the app's own first
  // JS-observable point for Share Extension usage; the extension itself
  // has no telemetry (it carries only a URL and timestamp — no
  // privileged credentials, execution-plan.md's "No privileged
  // credentials in extension").
  trackEvent('share_extension_drained', { count: shares.length });
}

// create_import_job's own abuse-control guards (supabase/migrations/
// 20260805100300_import_job_abuse_controls.sql) — a household-level rate
// limit, not a real outcome for this particular import. Hitting one mid-
// backlog means every remaining item in this run would hit it too, so
// there's no point continuing; the item that tripped it goes back to
// 'pending' for the next foreground/reconnect attempt rather than being
// surfaced to the user as failed.
const RETRY_LATER_MESSAGES = new Set([
  'please wait before importing another recipe',
  'too many imports for this household in the last hour',
]);

/**
 * Attempts to submit every outbox row that hasn't reached a terminal
 * state, oldest first. Callers gate this on being signed in, online, and
 * belonging to a household — a call made without those would just fail
 * every item for a reason unrelated to the import itself, so it's the
 * caller's job not to invoke this until they hold.
 */
export async function submitPendingOutboxItems(): Promise<void> {
  const db = await getDatabase();
  const items = await listSubmittableOutboxItems(db);

  for (const item of items) {
    await markOutboxItemSubmitting(db, item.id);
    try {
      const result = await submitImportJob({ url: item.url, clientImportId: item.id });
      await markOutboxItemSubmitted(db, item.id, result.jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (RETRY_LATER_MESSAGES.has(message)) {
        await markOutboxItemPending(db, item.id);
        return;
      }
      await markOutboxItemFailed(db, item.id, message);
      logError(error, { context: 'submitOutboxItem' });
    }
  }
}
