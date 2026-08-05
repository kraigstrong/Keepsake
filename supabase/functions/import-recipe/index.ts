/**
 * URL Import Foundation (Phase 8, ADR-0015), extended for Phase 9
 * bulk/durable import (ADR-0016 decision 4). The only piece of these
 * phases that can't be Jest-tested — it's the thin wiring layer over
 * server/import/*.ts and server/ai/extractRecipe.ts, which are all
 * unit-tested in Node already. Verified by an actual deploy + live
 * invocation against staging (see docs/phase-status.md), the same way
 * Phase 1's risk spike verified the real Claude call.
 *
 * Uses the caller's own JWT for every Supabase read/write (ADR-0015
 * decision 1) — never the service-role key — so RLS stays the real
 * enforcement boundary. Only ANTHROPIC_API_KEY is a genuinely new
 * server-only secret; SUPABASE_URL/SUPABASE_ANON_KEY are injected into
 * every Edge Function by the platform automatically.
 *
 * The request body accepts either "url" (Phase 8's original shape —
 * creates a fresh job) or "jobId" (a job already reserved by
 * create_import_batch, ADR-0016 decision 4), plus an optional
 * "clientImportId" (the durable Share Extension outbox's idempotency
 * key, ADR-0016 decision 2). Either path can land on a job that's
 * already past 'processing' — a pre-created batch item some earlier
 * call already finished, or a client_import_id replay — in which case
 * the pipeline is skipped entirely and the stored outcome is returned
 * as-is, never re-fetching or re-charging Anthropic for the same job.
 */
import { Anthropic } from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

import { extractRecipe, type RecipeExtraction } from '../../../server/ai/extractRecipe.ts';
import { extractHeroImageUrl } from '../../../server/import/extractHeroImageUrl.ts';
import { normalizeUrl } from '../../../server/import/normalizeUrl.ts';
import { reduceHtmlToText } from '../../../server/import/reduceHtmlToText.ts';
import { secureFetch, SecureFetchError } from '../../../server/import/secureFetch.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_USEFUL_REDUCED_TEXT_LENGTH = 200;

interface ImportJobRow {
  id: string;
  household_id: string;
  status: string;
  source_url: string;
  normalized_url: string;
  recipe_id: string | null;
  duplicate_of_recipe_id: string | null;
  error_message: string | null;
}

interface CategoryRow {
  id: string;
  value: string;
}

// Matches the recipe-images bucket's allowed_mime_types — anything
// secureFetch could return here is already one of these three.
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function resolveDns(hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(hostname, 'A'),
    Deno.resolveDns(hostname, 'AAAA'),
  ]);

  const addresses: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') addresses.push(...result.value);
  }
  if (addresses.length === 0) {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw failure ? failure.reason : new Error(`DNS resolution failed for ${hostname}`);
  }
  return addresses;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof SecureFetchError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  let requestedJobId: string | undefined;
  let rawUrl: string | undefined;
  let clientImportId: string | undefined;
  try {
    const body = (await req.json()) as { url?: unknown; jobId?: unknown; clientImportId?: unknown };
    if (body.jobId !== undefined) {
      if (typeof body.jobId !== 'string' || body.jobId.trim().length === 0) {
        return jsonResponse({ error: '"jobId" must be a non-empty string' }, 400);
      }
      requestedJobId = body.jobId;
    } else if (typeof body.url !== 'string' || body.url.trim().length === 0) {
      return jsonResponse(
        { error: 'Request body must include a non-empty "url" string, or a "jobId"' },
        400,
      );
    } else {
      rawUrl = body.url;
    }
    if (body.clientImportId !== undefined) {
      if (typeof body.clientImportId !== 'string') {
        return jsonResponse({ error: '"clientImportId" must be a string' }, 400);
      }
      clientImportId = body.clientImportId;
    }
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });

  let job: ImportJobRow;
  if (requestedJobId) {
    // A job create_import_batch already reserved (ADR-0016 decision 4).
    // RLS's own select policy on import_jobs is what enforces this can
    // only resolve to the caller's own household's job.
    const { data, error } = await supabase
      .from('import_jobs')
      .select(
        'id, household_id, status, source_url, normalized_url, recipe_id, duplicate_of_recipe_id, error_message',
      )
      .eq('id', requestedJobId)
      .single();
    if (error || !data) {
      return jsonResponse({ error: 'import job not found' }, 404);
    }
    job = data as ImportJobRow;
  } else {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(rawUrl!);
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 400);
    }
    const { data, error } = await supabase
      .rpc('create_import_job', {
        source_url: rawUrl,
        normalized_url: normalizedUrl,
        client_import_id: clientImportId ?? null,
      })
      .single();
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? 'Could not create import job' }, 400);
    }
    job = data as ImportJobRow;
  }

  if (job.status !== 'processing') {
    // Either a pre-created batch job an earlier call already finished,
    // or a client_import_id replay hit — the pipeline never runs twice
    // for the same job (ADR-0016 decision 4): no second fetch, no
    // second Anthropic call, just the outcome that's already stored.
    return jsonResponse(
      {
        jobId: job.id,
        recipeId: job.recipe_id ?? undefined,
        duplicate: job.duplicate_of_recipe_id != null,
        error: job.status === 'failed' ? (job.error_message ?? undefined) : undefined,
      },
      200,
    );
  }

  // A still-'processing' job isn't necessarily *this* call's to work —
  // two concurrent requests can both land here for the same job (a
  // client_import_id replay racing its own original request, or two
  // concurrent batch-item calls resolving the same jobId). Only the
  // caller that successfully claims it may run the pipeline; a losing
  // claim is a normal outcome of that race, not a real failure, so it
  // gets the same "stored outcome, no pipeline" shape as the check
  // above rather than a 5xx.
  {
    const { data: claimedJob, error: claimError } = await supabase
      .rpc('claim_import_job', { job_id: job.id })
      .single();
    if (claimError || !claimedJob) {
      return jsonResponse(
        {
          jobId: job.id,
          error: claimError?.message ?? 'import already in progress for this request',
        },
        200,
      );
    }
    job = claimedJob as ImportJobRow;
  }

  // Always recomputed from job.source_url rather than trusted from
  // job.normalized_url — a batch-created job's stored normalized_url is
  // only a placeholder equal to the raw url (create_import_batch can't
  // normalize; that's Deno/server-only code), so this is the one place
  // that actually computes the real value for both paths uniformly.
  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(job.source_url);
  } catch (error) {
    return await fail(400, errorMessage(error));
  }

  async function fail(status: number, message: string): Promise<Response> {
    await supabase.rpc('fail_import_job', { job_id: job.id, error_message: message });
    return jsonResponse({ jobId: job.id, error: message }, status);
  }

  try {
    // Duplicate detection (ADR-0015 decision 4) — before any fetch or AI
    // call. RLS already scopes this select to the caller's own
    // household, so no explicit household_id filter is needed here.
    const { data: existingRecipes } = await supabase
      .from('recipes')
      .select('id, source_url')
      .not('source_url', 'is', null);

    for (const existing of existingRecipes ?? []) {
      let existingNormalized: string;
      try {
        existingNormalized = normalizeUrl(existing.source_url as string);
      } catch {
        continue; // an old row with a malformed source_url — not a match, not fatal
      }
      if (existingNormalized === normalizedUrl) {
        const { data: completed, error } = await supabase
          .rpc('complete_import_job', {
            job_id: job.id,
            recipe_id: existing.id,
            duplicate_of_recipe_id: existing.id,
          })
          .single();
        if (error || !completed) {
          return jsonResponse(
            { jobId: job.id, error: error?.message ?? 'Could not complete import job' },
            500,
          );
        }
        return jsonResponse({ jobId: job.id, recipeId: existing.id, duplicate: true }, 200);
      }
    }

    // Fetch + reduce.
    let html: string;
    let finalUrl: string;
    try {
      const fetchResult = await secureFetch(normalizedUrl, {
        resolveDns,
        allowedContentTypePrefixes: ['text/html'],
        maxBytes: 2 * 1024 * 1024,
        timeoutMs: 10_000,
      });
      html = new TextDecoder().decode(fetchResult.bytes);
      finalUrl = fetchResult.finalUrl;
    } catch (error) {
      return await fail(502, `Could not fetch the page: ${errorMessage(error)}`);
    }

    const reducedText = reduceHtmlToText(html);
    if (reducedText.length < MIN_USEFUL_REDUCED_TEXT_LENGTH) {
      return await fail(422, 'Could not find enough recipe content on this page');
    }

    // AI extraction. Model strategy is environment-gated (developer
    // decision, 2026-08-05): only a deployment with APP_ENV=production
    // set uses the full Sonnet-primary/Opus-escalation cost — every
    // other deployment (including today's only deployed environment)
    // defaults to a single cheap Haiku call instead. See
    // ExtractRecipeOptions in extractRecipe.ts.
    let extraction: RecipeExtraction;
    try {
      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
      extraction = await extractRecipe(anthropic, reducedText, {
        useProductionModels: Deno.env.get('APP_ENV') === 'production',
      });
    } catch (error) {
      return await fail(502, `Recipe extraction failed: ${errorMessage(error)}`);
    }

    // Map AI-suggested category names onto real category ids — an
    // unmapped name is dropped, not passed through, since save_recipe
    // requires every categoryId to reference a real row (Phase 4's
    // atomicity test covers exactly this failure mode).
    const { data: categories } = await supabase.from('categories').select('id, value');
    const categoryByLowerValue = new Map(
      ((categories ?? []) as CategoryRow[]).map((c) => [c.value.toLowerCase(), c.id]),
    );
    const categoryIds = extraction.suggestedCategories
      .map((name) => categoryByLowerValue.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined);

    // Hero image acquisition (IMG-01) — best-effort. A failure here
    // doesn't fail the whole import; the recipe still gets created
    // without a hero image rather than being lost over an image fetch
    // hiccup.
    let heroImagePath: string | null = null;
    const heroImageUrl = extractHeroImageUrl(html, finalUrl);
    if (heroImageUrl) {
      try {
        const imageResult = await secureFetch(heroImageUrl, {
          resolveDns,
          // Matches the recipe-images bucket's own allowed_mime_types
          // exactly (supabase/migrations/20260802120800_recipe_images_
          // storage.sql) — Storage's own policy would reject anything
          // else anyway, but drawing the fetcher's boundary at the same
          // place avoids spending a fetch on a format we can never
          // actually store (e.g. an SVG site-logo fallback).
          allowedContentTypePrefixes: ['image/jpeg', 'image/png', 'image/webp'],
          maxBytes: 8 * 1024 * 1024,
          timeoutMs: 10_000,
        });
        const extension = CONTENT_TYPE_EXTENSIONS[imageResult.contentType] ?? 'jpg';
        const path = `${job.household_id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from('recipe-images')
          .upload(path, imageResult.bytes, { contentType: imageResult.contentType, upsert: false });
        if (!uploadError) heroImagePath = path;
      } catch {
        // best-effort — leave heroImagePath null
      }
    }

    const sourceAttribution = new URL(finalUrl).hostname;

    const { data: recipe, error: saveError } = await supabase
      .rpc('save_recipe', {
        payload: {
          title: extraction.title,
          heroImagePath,
          activeTimeMinutes: extraction.activeTimeMinutes,
          totalTimeMinutes: extraction.totalTimeMinutes,
          yieldText: extraction.yield,
          permanentNotes: null,
          sourceUrl: finalUrl,
          sourceAttribution,
          tags: extraction.suggestedTags,
          categoryIds,
          ingredientSections: extraction.ingredientSections.map((s) => ({
            title: s.heading,
            lines: s.items,
          })),
          instructionSections: extraction.instructionSections.map((s) => ({
            title: s.heading,
            lines: s.steps,
          })),
        },
      })
      .single();

    if (saveError || !recipe) {
      return await fail(502, saveError?.message ?? 'Could not save the imported recipe');
    }

    const savedRecipe = recipe as { id: string };
    const { error: completeError } = await supabase
      .rpc('complete_import_job', { job_id: job.id, recipe_id: savedRecipe.id })
      .single();
    if (completeError) {
      return jsonResponse({ jobId: job.id, error: completeError.message }, 500);
    }

    return jsonResponse(
      {
        jobId: job.id,
        recipeId: savedRecipe.id,
        duplicate: false,
        uncertainFields: extraction.uncertainFields,
      },
      200,
    );
  } catch (error) {
    return await fail(500, `Unexpected import failure: ${errorMessage(error)}`);
  }
});
