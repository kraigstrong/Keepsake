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
 * The request body accepts "url" (Phase 8's original shape — creates a
 * fresh job), "photoPath" (Phase 10, ADR-0017 — a Storage object path
 * the client already uploaded the preserved original photo to), or
 * "jobId" (a job already reserved by create_import_batch, ADR-0016
 * decision 4), plus an optional "clientImportId" (the durable Share
 * Extension outbox's idempotency key, ADR-0016 decision 2). Any path can
 * land on a job that's already past 'processing' — a pre-created batch
 * item some earlier call already finished, or a client_import_id replay
 * — in which case the pipeline is skipped entirely and the stored
 * outcome is returned as-is, never re-fetching or re-charging Anthropic
 * for the same job.
 *
 * ADR-0015 adds a JSON-LD structured-data hint to the URL path: when a
 * page's own schema.org Recipe markup is found, it's prepended to the
 * reduced text handed to Claude — the AI call itself is never skipped.
 *
 * ADR-0020 (Phase 11.5): claim_import_job now returns a claim_token
 * that every RPC able to close out a job (finalize_import_job,
 * complete_import_job, fail_import_job) must present and that gets
 * checked against the job's current claim — a worker whose claim has
 * since been superseded by a reclaim can no longer act on the job. The
 * AI-extraction path's save_recipe + complete_import_job two-call
 * sequence is also gone, replaced by one call to finalize_import_job,
 * which does both inside a single transaction.
 */
import { Anthropic } from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

import {
  extractRecipe,
  extractRecipeFromImage,
  type RecipeExtraction,
} from '../../../server/ai/extractRecipe.ts';
import { extractHeroImageUrl } from '../../../server/import/extractHeroImageUrl.ts';
import { extractJsonLdHint } from '../../../server/import/extractJsonLdHint.ts';
import { normalizeUrl } from '../../../server/import/normalizeUrl.ts';
import { reduceHtmlToText } from '../../../server/import/reduceHtmlToText.ts';
import { secureFetch, SecureFetchError } from '../../../server/import/secureFetch.ts';
import { sniffImageType } from '../../../server/import/sniffImageType.ts';
import { parseQuantity } from '../../../server/units/parseQuantity.ts';
import { parseServings } from '../../../server/units/parseServings.ts';

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
  source_url: string | null;
  normalized_url: string | null;
  photo_path: string | null;
  recipe_id: string | null;
  duplicate_of_recipe_id: string | null;
  error_message: string | null;
  claim_token: string | null;
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

// btoa (Web-standard, available in Deno) needs a plain "binary string",
// not a Uint8Array directly. String.fromCharCode.apply has an argument-
// count ceiling well under a multi-megabyte photo's byte length, so this
// builds the binary string in fixed-size chunks first — same technique
// commonly used to avoid that ceiling without pulling in a Buffer/base64
// dependency for something this small.
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
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
  let requestedPhotoPath: string | undefined;
  let clientImportId: string | undefined;
  try {
    const body = (await req.json()) as {
      url?: unknown;
      photoPath?: unknown;
      jobId?: unknown;
      clientImportId?: unknown;
    };
    if (body.jobId !== undefined) {
      if (typeof body.jobId !== 'string' || body.jobId.trim().length === 0) {
        return jsonResponse({ error: '"jobId" must be a non-empty string' }, 400);
      }
      requestedJobId = body.jobId;
    } else if (typeof body.url === 'string' && body.url.trim().length > 0) {
      rawUrl = body.url;
    } else if (typeof body.photoPath === 'string' && body.photoPath.trim().length > 0) {
      requestedPhotoPath = body.photoPath;
    } else {
      return jsonResponse(
        {
          error:
            'Request body must include a non-empty "url" string, a "photoPath" string, or a "jobId"',
        },
        400,
      );
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
        'id, household_id, status, source_url, normalized_url, photo_path, recipe_id, duplicate_of_recipe_id, error_message',
      )
      .eq('id', requestedJobId)
      .single();
    if (error || !data) {
      return jsonResponse({ error: 'import job not found' }, 404);
    }
    job = data as ImportJobRow;
  } else if (requestedPhotoPath) {
    // ADR-0017 decision 2/4: mirrors the url branch below, but there's
    // nothing to normalize for a photo — source_url/normalized_url stay
    // null on this job (create_import_job's xor check enforces exactly
    // one of source_url/photo_path is ever set).
    const { data, error } = await supabase
      .rpc('create_import_job', {
        photo_path: requestedPhotoPath,
        client_import_id: clientImportId ?? null,
      })
      .single();
    if (error || !data) {
      return jsonResponse({ error: error?.message ?? 'Could not create import job' }, 400);
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

  const isPhotoJob = job.photo_path != null;

  // Always recomputed from job.source_url rather than trusted from
  // job.normalized_url — a batch-created job's stored normalized_url is
  // only a placeholder equal to the raw url (create_import_batch can't
  // normalize; that's Deno/server-only code), so this is the one place
  // that actually computes the real value for both paths uniformly. Not
  // applicable to a photo-sourced job — there's no URL to normalize.
  let normalizedUrl: string | null = null;
  if (!isPhotoJob) {
    try {
      normalizedUrl = normalizeUrl(job.source_url!);
    } catch (error) {
      return await fail(400, errorMessage(error));
    }
  }

  async function fail(status: number, message: string): Promise<Response> {
    // ADR-0020: claim_token proves this call still holds the claim it
    // was given — a worker whose claim has since been superseded by a
    // reclaim can no longer mark the job failed out from under the new
    // claimant.
    await supabase.rpc('fail_import_job', {
      job_id: job.id,
      claim_token: job.claim_token,
      error_message: message,
    });
    return jsonResponse({ jobId: job.id, error: message }, status);
  }

  try {
    // Duplicate detection (ADR-0015 decision 4) is URL-only — a photo
    // has no comparable normalized key, and each photo capture is
    // treated as its own import, before any fetch or AI call. RLS
    // already scopes this select to the caller's own household, so no
    // explicit household_id filter is needed here.
    //
    // deleted_at is excluded (Phase 16, ADR-0025): without this, a
    // deleted recipe would still match here and silently resolve a
    // re-import to the hidden, deleted row instead of creating a fresh
    // one — recipes_household_source_url_idx already stopped enforcing
    // uniqueness against a deleted row for the same reason. archived_at
    // is deliberately NOT excluded — an archived recipe still counts as
    // "already have this" for import purposes, unchanged from before.
    if (!isPhotoJob) {
      const { data: existingRecipes } = await supabase
        .from('recipes')
        .select('id, source_url')
        .not('source_url', 'is', null)
        .is('deleted_at', null);

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
              claim_token: job.claim_token,
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
    }

    // AI extraction. Model strategy is environment-gated (developer
    // decision, 2026-08-05): only a deployment with APP_ENV=production
    // set uses the full Sonnet-primary/Opus-escalation cost for the URL
    // path — every other deployment defaults to a single cheap Haiku
    // call instead (ExtractRecipeOptions in extractRecipe.ts). The photo
    // path floors at Sonnet in every environment instead (ADR-0017
    // decision 3, ExtractRecipeFromImageOptions) — ordinary text
    // extraction and vision extraction intentionally use different
    // non-production defaults.
    const useProductionModels = Deno.env.get('APP_ENV') === 'production';
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

    let extraction: RecipeExtraction;
    // Populated on the URL path only, used for hero-image extraction and
    // source attribution below.
    let html: string | undefined;
    let finalUrl: string | undefined;
    // Populated on the photo path only.
    let heroImagePath: string | null = null;
    let originalPhotoPath: string | null = null;

    if (isPhotoJob) {
      originalPhotoPath = job.photo_path!;

      // Upload-before-processing (ADR-0017 decision 2): the original is
      // already durably stored by the time this function runs, so a
      // download failure here fails the job cleanly without having lost
      // the user's photo.
      const { data: photoBlob, error: downloadError } = await supabase.storage
        .from('recipe-images')
        .download(originalPhotoPath);
      if (downloadError || !photoBlob) {
        return await fail(
          502,
          `Could not read the uploaded photo: ${downloadError?.message ?? 'not found'}`,
        );
      }
      const photoBytes = new Uint8Array(await photoBlob.arrayBuffer());

      // T23 (threat-model.md, found by Codex review on PR #54): the
      // bucket's MIME allowlist only checked the upload's *declared*
      // contentType, not the actual bytes — a direct Storage API call
      // could label arbitrary bytes "image/jpeg" and force a wasted
      // vision-API call on them. Sniffing the real signature here, right
      // before the Anthropic call, closes that regardless of how the
      // object got into Storage; a mismatch fails the job cleanly
      // without spending a vision call on non-image bytes.
      const sniffedMediaType = sniffImageType(photoBytes);
      if (!sniffedMediaType) {
        return await fail(422, 'Uploaded file is not a recognized image (jpeg, png, or webp)');
      }
      const photoBase64 = uint8ArrayToBase64(photoBytes);

      try {
        extraction = await extractRecipeFromImage(anthropic, photoBase64, sniffedMediaType, {
          useProductionModels,
        });
      } catch (error) {
        return await fail(502, `Recipe extraction failed: ${errorMessage(error)}`);
      }

      // The uploaded original doubles as the initial hero image (no
      // og:image-equivalent exists for a photo import) — the user can
      // replace or remove it afterward via Phase 4's existing hero-image
      // flow without affecting original_photo_path, which stays pointed
      // at this same object regardless.
      heroImagePath = originalPhotoPath;
    } else {
      // Fetch + reduce.
      try {
        const fetchResult = await secureFetch(normalizedUrl!, {
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
      // ADR-0015: schema.org Recipe structured data (JSON-LD), when
      // present, becomes a sanitized hint prepended to what Claude sees
      // — never a bypass of the AI call itself (prd.md §8's documented
      // workflow runs on every import). A page whose visible text is
      // too thin to clear the usual bar can still be worth extracting
      // if it has real structured data underneath (a common pattern on
      // JS-rendered sites that still server-render JSON-LD for SEO).
      const jsonLdHint = extractJsonLdHint(html);
      if (reducedText.length < MIN_USEFUL_REDUCED_TEXT_LENGTH && !jsonLdHint) {
        return await fail(422, 'Could not find enough recipe content on this page');
      }
      const pageText = jsonLdHint ? `${jsonLdHint}\n\n${reducedText}` : reducedText;

      try {
        extraction = await extractRecipe(anthropic, pageText, { useProductionModels });
      } catch (error) {
        return await fail(502, `Recipe extraction failed: ${errorMessage(error)}`);
      }

      // Hero image acquisition (IMG-01) — best-effort. A failure here
      // doesn't fail the whole import; the recipe still gets created
      // without a hero image rather than being lost over an image fetch
      // hiccup.
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
            .upload(path, imageResult.bytes, {
              contentType: imageResult.contentType,
              upsert: false,
            });
          if (!uploadError) heroImagePath = path;
        } catch {
          // best-effort — leave heroImagePath null
        }
      }
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

    const sourceAttribution = finalUrl ? new URL(finalUrl).hostname : null;

    // ADR-0020: save_recipe and closing out the job used to be two
    // independent RPCs here — if the first succeeded and the second
    // failed (or the process died in between), a real recipe existed
    // while the job stayed 'processing' forever, reclaimable and
    // reprocessable. finalize_import_job runs both in one transaction
    // (and checks claim_token), so they now commit or roll back
    // together.
    const { data: finalizedJob, error: finalizeError } = await supabase
      .rpc('finalize_import_job', {
        job_id: job.id,
        claim_token: job.claim_token,
        recipe_payload: {
          title: extraction.title,
          heroImagePath,
          originalPhotoPath,
          activeTimeMinutes: extraction.activeTimeMinutes,
          totalTimeMinutes: extraction.totalTimeMinutes,
          yieldText: extraction.yield,
          servingsCount: parseServings(extraction.yield),
          // Only ever the source's own explicit labeled tip/note (see the
          // extraction prompt's strict inclusion criteria) — never a
          // summary or paraphrase, so this can't become REC-09's excluded
          // description field back under a different name.
          permanentNotes: extraction.notes,
          sourceUrl: finalUrl ?? null,
          sourceAttribution,
          tags: extraction.suggestedTags,
          categoryIds,
          // Quantity parsing (ADR-0018) runs here too, not just on
          // manual entry — an AI-extracted ingredient line is still
          // just text ("2 lb baby potatoes") until this same parser
          // reads it. A line the AI phrased ambiguously fails safely
          // the same way a hand-typed one would: every structured
          // field null, displayed as the extracted text verbatim.
          ingredientSections: extraction.ingredientSections.map((s) => ({
            title: s.heading,
            lines: s.items.map(parseQuantity),
          })),
          instructionSections: extraction.instructionSections.map((s) => ({
            title: s.heading,
            lines: s.steps,
          })),
        },
      })
      .single();

    if (finalizeError || !finalizedJob) {
      return await fail(502, finalizeError?.message ?? 'Could not save the imported recipe');
    }

    const finalized = finalizedJob as ImportJobRow;

    return jsonResponse(
      {
        jobId: job.id,
        recipeId: finalized.recipe_id ?? undefined,
        duplicate: false,
        uncertainFields: extraction.uncertainFields,
      },
      200,
    );
  } catch (error) {
    return await fail(500, `Unexpected import failure: ${errorMessage(error)}`);
  }
});
