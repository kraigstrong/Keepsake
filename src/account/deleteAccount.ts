import { FunctionsHttpError } from '@supabase/supabase-js';

import { logError } from '../observability';
import { withTimeout } from '../shared/withTimeout';
import { supabase } from '../supabase/instance';
import { wipeOfflineDataForAccountDeletion } from '../sync/wipeOfflineData';

/**
 * Account deletion, client half (ADR-0028). Three steps in a fixed order,
 * and the order is the design:
 *
 *   1. Sweep Storage — sole member only, and only after the user has
 *      confirmed. The Storage policies gate on `is_household_member`, and
 *      step 2 is what makes that false, so this cannot come later.
 *   2. Delete the data, one transaction, on the caller's own JWT.
 *   3. Delete the auth row, the only privileged step, last.
 *
 * Nothing here runs before the typed confirmation. The sweep destroys
 * data, so it belongs to the deletion rather than to preparing for it --
 * an earlier design ran it while the confirmation was on screen, which
 * meant cancelling cost a sole member every photo they had while leaving
 * the account they had just declined to delete perfectly intact.
 */
export type DeletionMode = 'sole' | 'shared' | 'no_household';

export type DeleteAccountResult =
  | { outcome: 'deleted' }
  | { outcome: 'stale'; message: string }
  | { outcome: 'failed'; message: string };

const STORAGE_PAGE_SIZE = 1000;
// Termination depends on `remove` actually removing. It should, but the
// loop below is destructive and re-lists what it just deleted, so a
// server-side no-op that still reports success would spin forever. Bounded
// for the same reason nothing else here waits without a floor; at a page
// per pass this is far more objects than a household will ever hold.
const STORAGE_SWEEP_MAX_PASSES = 200;
// supabase-js goes through fetch, which has no default timeout on React
// Native: a stalled request never settles, so without this the retry
// delay, the not-found check and the sign-out are all unreachable and the
// screen sits on "Deleting your account..." forever -- the exact shape
// #177 added withTimeout for. Generous, because the data transaction and
// the auth delete both happen inside one invocation.
const INVOKE_TIMEOUT_MS = 20_000;
const AUTH_CHECK_TIMEOUT_MS = 10_000;
const SIGN_OUT_TIMEOUT_MS = 10_000;

/** How many times the auth step is retried before falling back to the marker. */
const AUTH_RETRY_DELAYS_MS = [400, 1200];

/**
 * Whether this account is mid-deletion: the data is gone and the auth row
 * still owes removal (ADR-0028 decision 7). Read at sign-in, before any
 * onboarding UI, because "signed in with no profile" is otherwise
 * indistinguishable from a brand-new user -- and auto-completing a
 * deletion on that signal alone would delete real accounts that had
 * simply not finished signing up. The marker is what makes it
 * unambiguous; RLS scopes it to the caller's own row.
 */
export type PendingDeletionState = 'pending' | 'none' | 'unknown';

export async function hasPendingDeletion(): Promise<PendingDeletionState> {
  const { data, error } = await supabase.from('account_deletions').select('user_id').maybeSingle();
  if (error) {
    // Deliberately not 'none'. Collapsing a failed read into "no deletion
    // pending" lets onboarding render on a transient PostgREST error, and
    // a half-deleted user can then create a profile -- after which the
    // recovery check never runs again, because it is gated on there being
    // no profile, and the auth row survives indefinitely. Unknown has to
    // stay unknown and keep the door shut.
    logError(error, { context: 'hasPendingDeletion' });
    return 'unknown';
  }
  return data != null ? 'pending' : 'none';
}

/**
 * Finishes a deletion whose auth step never completed. The data half is a
 * no-op by postcondition, so this is safe to run against an account that
 * is already partly gone -- which is the only kind that gets here.
 */
export async function resumePendingDeletion(): Promise<DeleteAccountResult> {
  return deleteAccount('no_household', null);
}

export interface DeletionPlan {
  mode: DeletionMode;
  /**
   * Read from the server alongside the mode, not taken from local state.
   * A device sitting on onboarding can have `household === null` while
   * another device has already created one -- `prepare` then correctly
   * says 'sole' while the local id says there is nothing to sweep, and
   * the images survive a deletion that has revoked the only permission
   * that could remove them.
   */
  householdId: string | null;
}

export async function prepareAccountDeletion(): Promise<DeletionPlan> {
  const { data, error } = await supabase.rpc('prepare_account_deletion');
  if (error) throw error;
  const { data: household, error: householdError } = await supabase
    .from('households')
    .select('id')
    .maybeSingle();
  if (householdError) throw householdError;
  return { mode: data as DeletionMode, householdId: household?.id ?? null };
}

/**
 * Runs before the data transaction, because the Storage policies gate on
 * `is_household_member` and that transaction is what makes it false --
 * this is the caller's last chance to delete their own files.
 *
 * Which is exactly why a partial sweep must not continue. An earlier
 * version listed one page, logged any failure and carried on into the
 * destructive RPC: a household with more than a page of images, or one
 * transient list error, left objects behind *and* revoked the only
 * identity that could ever retry. ADR-0028 chose the fail-loudly branch
 * over recording orphans for a later sweep, because nothing in this
 * stack schedules work to consume such a record. So this pages to
 * exhaustion and propagates the first failure; the caller aborts with
 * the account still intact and the whole flow retryable from the start.
 */
async function sweepHouseholdStorage(householdId: string): Promise<void> {
  for (const prefix of [householdId, `${householdId}/originals`]) {
    // Always from offset 0, never an advancing cursor. This deletes what
    // it lists, so the offsets shift under it: paging to 1000 after
    // removing the first thousand asks for what are now objects 2000+ and
    // silently skips everything between. Each pass removes at least one
    // object and the bucket is finite, so this terminates.
    for (let pass = 0; ; pass += 1) {
      if (pass >= STORAGE_SWEEP_MAX_PASSES) {
        throw new Error(`Storage sweep did not converge for ${prefix}`);
      }
      const { data, error } = await supabase.storage.from('recipe-images').list(prefix, {
        limit: STORAGE_PAGE_SIZE,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const page = data ?? [];
      if (page.length === 0) break;

      // Folder placeholders have a null id and cannot be removed, so a
      // page of nothing but placeholders would otherwise loop forever --
      // listing `<household>/` returns the `originals` folder itself.
      const paths = page
        .filter((object) => object.id !== null)
        .map((object) => `${prefix}/${object.name}`);
      if (paths.length === 0) break;

      const { error: removeError } = await supabase.storage.from('recipe-images').remove(paths);
      if (removeError) throw removeError;
    }
  }
}

function messageFrom(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

/**
 * Completion is proven by a positive "no such user", never by the absence
 * of a successful authentication. An expired access token, a session
 * revoked elsewhere and a transient auth-service error all present as
 * "cannot authenticate" while the row is still there -- treating any of
 * them as terminal would report a successful deletion, sign the user out,
 * and leave the account standing.
 *
 * But the absence is usually reported *as an error*, not as a successful
 * response carrying a null user: GoTrue answers a token whose subject no
 * longer exists with `user_not_found`. Treating every error as "still
 * there" -- which an earlier version did -- discards the one positive
 * signal this exists to catch, so a lost response would exhaust its
 * retries and report failure on a deletion that had already succeeded.
 * `user_not_found` is definitive; `bad_jwt` and `session_not_found` are
 * not, because a malformed or stale token produces them too.
 */
function isDefinitiveNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'user_not_found'
  );
}

async function authRowIsGone(): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(),
      AUTH_CHECK_TIMEOUT_MS,
      'getUser',
    );
    if (error) return isDefinitiveNotFound(error);
    return data?.user == null;
  } catch {
    // A stalled check proves nothing either way, and "proves nothing" has
    // to mean "not deleted" here.
    return false;
  }
}

/**
 * The account is already gone server-side by the time this runs, so
 * nothing here may prevent the sign-out. A failed SQLite or image-cache
 * cleanup used to reject straight past it, leaving the UI on "Deleting
 * your account…" forever with a live local session for an account that no
 * longer exists -- a worse outcome than the stale rows it was trying to
 * clear. Both steps are best-effort and the flow always terminates.
 */
async function finishLocally(): Promise<void> {
  try {
    await wipeOfflineDataForAccountDeletion();
  } catch (error) {
    logError(error, { context: 'deleteAccount.wipe' });
  }
  // signOut resolves with { error } rather than throwing, so a try/catch
  // alone lets a failed logout through silently -- and a failed logout
  // means no auth-state event, a still-cached session, and a UI left on
  // "Deleting your account..." for an account that no longer exists. The
  // local-scope retry clears the stored session without a network call,
  // which is the part that actually has to happen here.
  try {
    // Bounded like the others: a stalled logout after the account is
    // already gone would otherwise make the local fallback unreachable
    // and leave the screen on "Deleting your account..." indefinitely.
    const { error } = await withTimeout(supabase.auth.signOut(), SIGN_OUT_TIMEOUT_MS, 'signOut');
    if (error) {
      logError(error, { context: 'deleteAccount.signOut' });
      await supabase.auth.signOut({ scope: 'local' });
    }
  } catch (error) {
    logError(error, { context: 'deleteAccount.signOut' });
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (localError) {
      logError(localError, { context: 'deleteAccount.signOutLocal' });
    }
  }
}

export async function deleteAccount(
  expectedMode: DeletionMode,
  householdId: string | null,
): Promise<DeleteAccountResult> {
  if (expectedMode === 'sole' && householdId) {
    try {
      await sweepHouseholdStorage(householdId);
    } catch (error) {
      logError(error, { context: 'deleteAccount.sweep' });
      return {
        outcome: 'failed',
        message:
          "We couldn't remove your photos, so nothing has been deleted. Please check your connection and try again.",
      };
    }
  }

  for (let attempt = 0; ; attempt += 1) {
    let error: unknown = null;
    try {
      ({ error } = await withTimeout(
        supabase.functions.invoke('delete-account', { body: { mode: expectedMode } }),
        INVOKE_TIMEOUT_MS,
        'delete-account',
      ));
    } catch (timeout) {
      // A stall is indistinguishable from a slow success from here, so it
      // falls through to the same not-found check as any other failure.
      error = timeout;
    }

    if (!error) {
      await finishLocally();
      return { outcome: 'deleted' };
    }

    // The function ran and rejected us. Its own body carries why, and a
    // fence mismatch is the one case the user has to be told about rather
    // than retried through: somebody joined while they were confirming.
    if (error instanceof FunctionsHttpError) {
      let body: { error?: string; stage?: string } = {};
      try {
        body = (await error.context.clone().json()) as typeof body;
      } catch {
        // not JSON — fall through to the generic path below
      }
      // Only the fence is genuinely "your household changed". Other
      // data-stage failures can accompany a deletion that did complete --
      // two devices racing, the second RPC failing to insert its marker
      // because the first already removed the auth row it references --
      // so those fall through to the not-found check below rather than
      // reporting a household change that never happened.
      if (body.stage === 'data' && body.error?.includes('membership changed since confirmation')) {
        return { outcome: 'stale', message: body.error };
      }
    }

    // The auth step may have succeeded with its response lost. Ask.
    if (await authRowIsGone()) {
      await finishLocally();
      return { outcome: 'deleted' };
    }

    const delay = AUTH_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      logError(error, { context: 'deleteAccount.exhausted' });
      return {
        outcome: 'failed',
        message: messageFrom(
          error,
          "We couldn't finish deleting your account. Your data is gone; the account itself will be removed next time you sign in.",
        ),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
