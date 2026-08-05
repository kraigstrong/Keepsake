/**
 * URL Import Foundation (Phase 8, ADR-0015). The only piece of this
 * phase that can't be Jest-tested — it's the thin wiring layer over
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
}

interface CategoryRow {
  id: string;
  value: string;
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
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

  let rawUrl: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (typeof body.url !== 'string' || body.url.trim().length === 0) {
      return jsonResponse({ error: 'Request body must include a non-empty "url" string' }, 400);
    }
    rawUrl = body.url;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeUrl(rawUrl);
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });

  let job: ImportJobRow;
  {
    const { data, error } = await supabase
      .rpc('create_import_job', { source_url: rawUrl, normalized_url: normalizedUrl })
      .single();
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? 'Could not create import job' }, 400);
    }
    job = data as ImportJobRow;
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

    // AI extraction.
    let extraction: RecipeExtraction;
    try {
      const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
      extraction = await extractRecipe(anthropic, reducedText);
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
          allowedContentTypePrefixes: ['image/'],
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
