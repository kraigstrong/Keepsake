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
