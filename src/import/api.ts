import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';

export interface ImportRecipeResult {
  jobId: string;
  recipeId: string;
  duplicate: boolean;
  uncertainFields: string[];
}

/**
 * Thin client wrapper over the import-recipe Edge Function (ADR-0015).
 * `functions.invoke` forwards the current session's JWT automatically —
 * the same RLS-scoped identity every other write in this app uses, no
 * different here.
 *
 * Emits a timing-only telemetry event on completion (duration + whether
 * it resolved to a duplicate, or just duration on failure) — never the
 * URL, the page's domain, or any recipe content, per prd.md §30's
 * "exclude recipe content ... from logs and analytics" and the same
 * "raw search terms excluded" precedent Phase 7 set for search_performed.
 */
export async function importRecipeFromUrl(url: string): Promise<ImportRecipeResult> {
  const startedAt = Date.now();

  try {
    const { data, error } = await supabase.functions.invoke('import-recipe', { body: { url } });

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

    const result = data as ImportRecipeResult;
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
