import { FunctionsHttpError } from '@supabase/supabase-js';

import { preserveOriginalPhoto, uploadOriginalPhoto } from '../photoImport/photoImport';
import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';

export interface ImportRecipeResult {
  jobId: string;
  recipeId?: string;
  duplicate: boolean;
  uncertainFields?: string[];
}

/**
 * Thrown when submitImportJob gets no confirmed response from the Edge
 * Function (FunctionsFetchError/FunctionsRelayError) rather than a
 * confirmed non-2xx (FunctionsHttpError) — the one failure class safe
 * to retry with the same clientImportId, per ADR-0016's idempotent
 * replay; a confirmed failure's outcome is already durably stored
 * against that id, so retrying it would just replay the same result.
 * Classified via `instanceof FunctionsHttpError`, not `.context` shape —
 * FunctionsRelayError's context is also a real Response.
 */
export class ImportTransportError extends Error {}

export interface ImportJobRequest {
  // Exactly one of url (Phase 8's original shape), photoPath (Phase 10,
  // ADR-0017 — a Storage object path already uploaded), or jobId (a job
  // create_import_batch already reserved, ADR-0016 decision 4) — the
  // Edge Function itself enforces this.
  url?: string;
  photoPath?: string;
  jobId?: string;
  // The durable Share Extension outbox's idempotency key (ADR-0016
  // decision 2) — omitted for the plain single-URL screen and for
  // batch items, which are already idempotent via jobId. Never used by
  // the photo path (ADR-0017 decision 4: camera/photo import is
  // synchronous and interactive, not routed through the outbox).
  clientImportId?: string;
}

/**
 * Thin client wrapper over the import-recipe Edge Function (ADR-0015,
 * extended ADR-0016 decision 4). `functions.invoke` forwards the current
 * session's JWT automatically — the same RLS-scoped identity every other
 * write in this app uses, no different here.
 *
 * A 200 response can still carry a stored failure (a pre-created batch
 * job or a client_import_id replay that had already failed) — surfaced
 * here the same way a transport-level error is, so every caller only
 * has one failure path to handle.
 *
 * Emits a timing-only telemetry event on completion (duration + whether
 * it resolved to a duplicate, or just duration on failure) — never the
 * URL, the page's domain, or any recipe content, per prd.md §30's
 * "exclude recipe content ... from logs and analytics" and the same
 * "raw search terms excluded" precedent Phase 7 set for search_performed.
 */
export async function submitImportJob(request: ImportJobRequest): Promise<ImportRecipeResult> {
  const startedAt = Date.now();

  try {
    const { data, error } = await supabase.functions.invoke('import-recipe', { body: request });

    if (error) {
      // FunctionsHttpError is the one case where the function actually
      // ran — its .context carries the real response, our own
      // { error: string } shape included, so surface that message
      // rather than a generic one. See ImportTransportError above for
      // why this is checked by class, not by duck-typing .context.
      const isConfirmedResponse = error instanceof FunctionsHttpError;
      let specificMessage: string | undefined;
      if (isConfirmedResponse) {
        try {
          const body = (await error.context.clone().json()) as { error?: string };
          specificMessage = body.error;
        } catch {
          // response body wasn't JSON — fall through to the generic message
        }
      }
      const message = specificMessage ?? error.message;
      throw isConfirmedResponse ? new Error(message) : new ImportTransportError(message);
    }

    const result = data as ImportRecipeResult & { error?: string };
    if (result.error) {
      throw new Error(result.error);
    }

    trackEvent('import_completed', {
      durationMs: Date.now() - startedAt,
      duplicate: result.duplicate,
    });
    return result;
  } catch (error) {
    trackEvent('import_failed', { durationMs: Date.now() - startedAt });
    throw error;
  }
}

export async function importRecipeFromUrl(url: string): Promise<ImportRecipeResult> {
  return submitImportJob({ url });
}

/**
 * Upload-before-processing (ADR-0017 decision 2): preserves (strips
 * metadata, resizes) and uploads the captured/picked photo to Storage
 * first, then submits the job with a path rather than image bytes — the
 * original is durably saved even if extraction itself fails afterward.
 * The preserve/upload steps are wrapped in their own timing/failure
 * telemetry (distinct from submitImportJob's own import_completed/
 * import_failed) so a Storage failure here is observable the same way a
 * fetch or extraction failure already is on the URL path — this is a
 * real, reachable failure mode (e.g. offline, Storage quota), not a
 * hypothetical worth leaving silent.
 */
export async function importRecipeFromPhoto(
  householdId: string,
  localUri: string,
): Promise<ImportRecipeResult> {
  const startedAt = Date.now();
  let photoPath: string;
  try {
    const preservedUri = await preserveOriginalPhoto(localUri);
    photoPath = await uploadOriginalPhoto(householdId, preservedUri);
  } catch (error) {
    trackEvent('photo_import_upload_failed', { durationMs: Date.now() - startedAt });
    throw error;
  }

  return submitImportJob({ photoPath });
}

export interface BatchJobStub {
  batchId: string;
  jobId: string;
  sourceUrl: string;
  status: string;
  recipeId?: string;
  duplicate?: boolean;
  errorMessage?: string;
}

interface BatchJobRow {
  batch_id: string;
  job_id: string;
  source_url: string;
  status: string;
}

/**
 * Reserves a batch's job rows (ADR-0016 decision 3/4) — a plain Postgres
 * RPC, no external I/O, called directly rather than through an Edge
 * Function, same as save_recipe and every other RPC that doesn't need a
 * server-only secret. Returns immediately (this call itself does no
 * fetching or AI work); actually processing each job is a separate step
 * (see submitImportJob({ jobId }) and src/import/batchEngine.ts), so a
 * caller can reserve the batch and move on without blocking on it here.
 */
export async function createImportBatch(urls: string[]): Promise<BatchJobStub[]> {
  const { data, error } = await supabase.rpc('create_import_batch', { urls });
  if (error) {
    throw new Error(error.message);
  }
  // Count only — never the URLs themselves, same "no raw content" rule
  // import_completed/import_failed already follow (prd.md §30).
  trackEvent('bulk_import_started', { urlCount: urls.length });
  return ((data ?? []) as BatchJobRow[]).map((row) => ({
    batchId: row.batch_id,
    jobId: row.job_id,
    sourceUrl: row.source_url,
    status: row.status,
  }));
}

/** Polls a batch's jobs — used by the Import Activity screen to render
 * live per-item progress and to find jobs still 'processing' that need
 * (re-)submitting on mount, including after leaving and returning. */
export async function fetchBatchJobs(batchId: string): Promise<BatchJobStub[]> {
  const { data, error } = await supabase
    .from('import_jobs')
    .select('id, batch_id, source_url, status, recipe_id, duplicate_of_recipe_id, error_message')
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({
    batchId: row.batch_id as string,
    jobId: row.id as string,
    sourceUrl: row.source_url as string,
    status: row.status as string,
    recipeId: (row.recipe_id as string | null) ?? undefined,
    duplicate: row.duplicate_of_recipe_id != null,
    errorMessage: (row.error_message as string | null) ?? undefined,
  }));
}
