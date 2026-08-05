import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';

export interface ImportRecipeResult {
  jobId: string;
  recipeId?: string;
  duplicate: boolean;
  uncertainFields?: string[];
}

export interface ImportJobRequest {
  // Either url (Phase 8's original shape, creates a fresh job) or jobId
  // (a job create_import_batch already reserved, ADR-0016 decision 4) —
  // the Edge Function itself enforces exactly one is required.
  url?: string;
  jobId?: string;
  // The durable Share Extension outbox's idempotency key (ADR-0016
  // decision 2) — omitted for the plain single-URL screen and for
  // batch items, which are already idempotent via jobId.
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
      // Supabase's FunctionsHttpError carries the actual response body
      // (our own { error: string } shape) on .context — surface that
      // message when present rather than a generic transport error.
      const context = (error as { context?: Response }).context;
      let specificMessage: string | undefined;
      if (context) {
        try {
          const body = (await context.clone().json()) as { error?: string };
          specificMessage = body.error;
        } catch {
          // response body wasn't JSON — fall through to the generic message
        }
      }
      throw new Error(specificMessage ?? error.message);
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

export interface BatchJobStub {
  batchId: string;
  jobId: string;
  sourceUrl: string;
  status: string;
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
    .select('id, batch_id, source_url, status')
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
  }));
}
