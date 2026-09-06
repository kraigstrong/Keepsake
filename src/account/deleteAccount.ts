import { FunctionsHttpError } from '@supabase/supabase-js';

import { logError } from '../observability';
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

/** How many times the auth step is retried before falling back to the marker. */
const AUTH_RETRY_DELAYS_MS = [400, 1200];

export async function prepareAccountDeletion(): Promise<DeletionMode> {
  const { data, error } = await supabase.rpc('prepare_account_deletion');
  if (error) throw error;
  return data as DeletionMode;
}

/**
 * Best-effort, and deliberately so. Once the household row is gone
 * `is_household_member` is false for everyone forever and the id is a
 * uuid that will not recur, so a leftover object is unreachable through
 * every application path -- this is a storage-cost and hygiene concern,
 * not a confidentiality one. It still runs first, because after step 2
 * the caller has lost the right to delete their own files.
 */
async function sweepHouseholdStorage(householdId: string): Promise<void> {
  const prefixes = [householdId, `${householdId}/originals`];
  for (const prefix of prefixes) {
    const { data, error } = await supabase.storage.from('recipe-images').list(prefix, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      logError(error, { context: 'deleteAccount.sweepList', prefix });
      continue;
    }
    const paths = (data ?? [])
      .filter((object) => object.id !== null)
      .map((object) => `${prefix}/${object.name}`);
    if (paths.length === 0) continue;
    const { error: removeError } = await supabase.storage.from('recipe-images').remove(paths);
    if (removeError) logError(removeError, { context: 'deleteAccount.sweepRemove', prefix });
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
 */
async function authRowIsGone(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return false;
  return data?.user == null;
}

export async function deleteAccount(
  expectedMode: DeletionMode,
  householdId: string | null,
): Promise<DeleteAccountResult> {
  if (expectedMode === 'sole' && householdId) {
    await sweepHouseholdStorage(householdId);
  }

  for (let attempt = 0; ; attempt += 1) {
    const { error } = await supabase.functions.invoke('delete-account', {
      body: { mode: expectedMode },
    });

    if (!error) {
      await wipeOfflineDataForAccountDeletion();
      await supabase.auth.signOut();
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
      if (body.stage === 'data') {
        return { outcome: 'stale', message: body.error ?? 'Please try again.' };
      }
    }

    // The auth step may have succeeded with its response lost. Ask.
    if (await authRowIsGone()) {
      await wipeOfflineDataForAccountDeletion();
      await supabase.auth.signOut();
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
