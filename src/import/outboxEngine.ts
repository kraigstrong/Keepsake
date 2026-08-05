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
  // A concurrent request already claimed this job (claim_import_job) —
  // a normal outcome of two callers racing for the same job, not a
  // real failure; the next attempt either finds the job already
  // resolved (idempotent replay) or, if the claimant died mid-flight,
  // reclaims it itself after the 60s staleness window.
  'import already in progress for this request',
]);

// execution-plan.md's Phase 9 security scope: "Staging data expires" — a
// share that's never submitted (the app isn't reopened signed-in for a
// long stretch) shouldn't sit in local storage indefinitely. 30 days is
// generous for a real gap in usage while still bounding it; expired
// items are marked failed with an explicit reason rather than silently
// dropped, so the user can see what happened rather than a share just
// quietly vanishing.
const OUTBOX_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function isExpired(item: { receivedAt: string }, now: Date): boolean {
  return now.getTime() - new Date(item.receivedAt).getTime() > OUTBOX_EXPIRY_MS;
}

export interface OutboxSubmissionOutcome {
  id: string;
  status: 'submitted' | 'failed';
  recipeId?: string;
  duplicate?: boolean;
  errorMessage?: string;
}

/**
 * Attempts to submit every outbox row that hasn't reached a terminal
 * state, oldest first. Callers gate this on being signed in, online, and
 * belonging to a household — a call made without those would just fail
 * every item for a reason unrelated to the import itself, so it's the
 * caller's job not to invoke this until they hold.
 *
 * Returns what happened to each item attempted (not the ones left
 * 'pending' by a rate-limit guard) so a caller can surface it — a
 * Share-Extension-originated import has no screen of its own to land on
 * or show an inline error the way the single-URL import screen does, so
 * without this, "I shared something, then what?" has no answer at all.
 */
export async function submitPendingOutboxItems(): Promise<OutboxSubmissionOutcome[]> {
  const db = await getDatabase();
  const items = await listSubmittableOutboxItems(db);
  const now = new Date();
  const outcomes: OutboxSubmissionOutcome[] = [];

  for (const item of items) {
    if (isExpired(item, now)) {
      const errorMessage = 'This import was never completed and has expired.';
      await markOutboxItemFailed(db, item.id, errorMessage);
      outcomes.push({ id: item.id, status: 'failed', errorMessage });
      continue;
    }

    await markOutboxItemSubmitting(db, item.id);
    try {
      const result = await submitImportJob({ url: item.url, clientImportId: item.id });
      await markOutboxItemSubmitted(db, item.id, result.jobId);
      outcomes.push({
        id: item.id,
        status: 'submitted',
        recipeId: result.recipeId,
        duplicate: result.duplicate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (RETRY_LATER_MESSAGES.has(message)) {
        await markOutboxItemPending(db, item.id);
        return outcomes;
      }
      await markOutboxItemFailed(db, item.id, message);
      outcomes.push({ id: item.id, status: 'failed', errorMessage: message });
      logError(error, { context: 'submitOutboxItem' });
    }
  }

  return outcomes;
}

/**
 * Turns a batch of outcomes into one toast-sized message. Multiple
 * outcomes get a summary rather than one toast per item — ToastProvider
 * shows a single message at a time, so firing several in a row would
 * only ever leave the last one visible.
 */
export function summarizeOutboxOutcomes(outcomes: OutboxSubmissionOutcome[]): string | null {
  if (outcomes.length === 0) return null;

  if (outcomes.length === 1) {
    const [outcome] = outcomes;
    if (outcome!.status === 'failed') return "Couldn't import a recipe you shared";
    return outcome!.duplicate ? 'Already in your library' : 'Recipe imported from Share';
  }

  const succeeded = outcomes.filter((outcome) => outcome.status === 'submitted').length;
  const failed = outcomes.length - succeeded;
  if (failed === 0) return `${succeeded} recipes imported from Share`;
  if (succeeded === 0) {
    return `Couldn't import ${failed} shared recipe${failed === 1 ? '' : 's'}`;
  }
  return `${succeeded} imported, ${failed} failed`;
}
