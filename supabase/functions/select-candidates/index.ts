/**
 * select-candidates Edge Function (ADR-0027 decision 5): orchestrates a
 * selection round's two-commit creation path — create_selection_round,
 * then finalize_selection_round_candidates — with the candidate
 * eligibility filter (`docs/proposals/smart-meal-selection-
 * architecture.md` §5) run in between. Same caller's-JWT/no-service-role
 * boundary `import-recipe` uses (ADR-0015): every read here is RLS-
 * scoped exactly like an ordinary client call.
 *
 * Candidate generation is the filter (proposal §5) plus the Smart
 * Selection v1 heuristic (`server/selection/scoreCandidates.ts`,
 * `candidate_strategy_version: 'heuristic-v1'`): this function gathers
 * the household-scoped aggregates that module needs
 * (`server/selection/fetchCandidateScoringInput.ts`) and hands them to
 * it — the module itself stays database-free.
 *
 * finalize_selection_round_candidates is not a trust boundary (ADR-0027
 * decision 5) — it re-derives and validates every recipe_id itself, so
 * this function calling it with a hand-built array confers no special
 * trust. What finalize deliberately does NOT re-check is "not already
 * in the household's current This Week plan" (racy — rejecting a whole
 * deck over a mid-flight add would turn a rare race into a visible
 * failure), so this function is the only place that check happens.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  buildCandidateSnapshots,
  fetchThisWeekTagsAndCategoryKeys,
} from '../../../server/selection/fetchCandidateScoringInput.ts';
import { scoreCandidates } from '../../../server/selection/scoreCandidates.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Matches the proposal §5 example ("target 4 -> deck of 12") — the
// client can override, but a round started without one still gets a
// sane deck rather than computeDeckSize(null) blowing up.
const DEFAULT_TARGET_COUNT = 4;

const STRATEGY_VERSION = 'heuristic-v1';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

interface RequestBody {
  mode?: unknown;
  participantUserIds?: unknown;
  targetCount?: unknown;
  closesAt?: unknown;
}

interface ParsedRequest {
  mode: 'solo' | 'group';
  participantUserIds: string[];
  targetCount: number;
  closesAt: string | null;
}

/** Returns a jsonResponse to send back on a validation failure, else the parsed request. */
function parseRequestBody(body: RequestBody): ParsedRequest | Response {
  if (body.mode !== 'solo' && body.mode !== 'group') {
    return jsonResponse({ error: '"mode" must be "solo" or "group"' }, 400);
  }

  let participantUserIds: string[] = [];
  if (body.participantUserIds !== undefined) {
    if (
      !Array.isArray(body.participantUserIds) ||
      !body.participantUserIds.every((id) => typeof id === 'string')
    ) {
      return jsonResponse({ error: '"participantUserIds" must be an array of strings' }, 400);
    }
    participantUserIds = body.participantUserIds;
  }

  let targetCount = DEFAULT_TARGET_COUNT;
  if (body.targetCount !== undefined) {
    if (
      typeof body.targetCount !== 'number' ||
      !Number.isInteger(body.targetCount) ||
      body.targetCount <= 0
    ) {
      return jsonResponse({ error: '"targetCount" must be a positive integer' }, 400);
    }
    targetCount = body.targetCount;
  }

  let closesAt: string | null = null;
  if (body.closesAt !== undefined) {
    if (typeof body.closesAt !== 'string') {
      return jsonResponse({ error: '"closesAt" must be an ISO timestamp string' }, 400);
    }
    closesAt = body.closesAt;
  }

  return { mode: body.mode, participantUserIds, targetCount, closesAt };
}

/**
 * "Current" without re-deriving week_key's device-local ISO-week
 * algorithm server-side (ADR-0021: no household timezone is stored
 * anywhere, so there's no more-correct server-side answer either).
 * week_key's zero-padded "YYYY-Www" format sorts lexicographically the
 * same as chronologically, so the most recent row by that column is
 * this week's plan without computing today's date at all. No plan yet
 * existing just means nothing to exclude.
 */
async function fetchCurrentThisWeekRecipeIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data: plan, error: planError } = await supabase
    .from('weekly_plans')
    .select('id')
    .order('week_key', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planError) throw new Error(planError.message);
  if (!plan) return new Set();

  const { data: entries, error: entriesError } = await supabase
    .from('planning_entries')
    .select('recipe_id')
    .eq('weekly_plan_id', (plan as { id: string }).id);
  if (entriesError) throw new Error(entriesError.message);

  return new Set((entries ?? []).map((e) => (e as { recipe_id: string }).recipe_id));
}

// Ordered by primary key (not created_at) purely for a deterministic
// pool with no possible tie going into scoreCandidates — that module's
// own stableHash tie-break (over roundId + recipeId) is what actually
// orders the deck; this order never reaches the client.
async function fetchEligibleRecipeIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id')
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { id: string }).id);
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

  let parsed: ParsedRequest;
  try {
    const json = await req.json();
    // A bare JSON literal (null, "x", 3, an array) parses without
    // throwing, but would then throw inside parseRequestBody on its
    // first property access, landing in the catch below with a
    // misleading "not valid JSON" message for a body that was valid
    // JSON, just not an object.
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return jsonResponse({ error: 'Request body must be a JSON object' }, 400);
    }
    const result = parseRequestBody(json as RequestBody);
    if (result instanceof Response) return result;
    parsed = result;
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400);
  }

  // Caller's own JWT, never service-role (ADR-0015/ADR-0027 decision
  // 5) — RLS applies to every read/RPC call below exactly as it would
  // for any other client request.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  });

  // Step 1: claim a pending round (ADR-0027 decision 1a) — born
  // pending_candidates, recoverable by retry if anything below fails.
  const { data: created, error: createError } = await supabase
    .rpc('create_selection_round', {
      mode: parsed.mode,
      participant_user_ids: parsed.participantUserIds,
      target_count: parsed.targetCount,
      closes_at: parsed.closesAt,
    })
    .single();

  if (createError || !created) {
    // The singleton index (decision 1) is a real conflict, not a
    // malformed request — everything else create_selection_round raises
    // is caller-input validation. Two concurrent creates that both find
    // no existing round to adopt race the INSERT itself, not the RPC's
    // own guard, so this also has to catch the raw Postgres
    // unique_violation (23505) the loser gets — matching only the RPC's
    // own wording would misclassify that race as a 400.
    const message = createError?.message ?? 'Could not start a selection round';
    const isSingletonConflict =
      createError?.code === '23505' || /already (in progress|starting)/.test(message);
    if (isSingletonConflict) {
      // Carry the existing round's id, so a retry after a lost 200 can
      // resume the round it actually created instead of being stuck: the
      // client knows a round exists but otherwise has no way to name it
      // (get_selection_round needs the id it never received). Reading it
      // is RLS-scoped like any other household read, and best-effort —
      // the conflict itself is still reported if the lookup fails.
      const { data: existing } = await supabase
        .from('selection_rounds')
        .select('id')
        .in('status', ['pending_candidates', 'active', 'ready_for_review'])
        .maybeSingle();
      return jsonResponse(
        {
          error: 'a selection round is already in progress for this household',
          roundId: (existing as { id: string } | null)?.id ?? null,
        },
        409,
      );
    }
    return jsonResponse({ error: message }, 400);
  }

  const { round_id: roundId, claim_token: claimToken } = created as {
    round_id: string;
    claim_token: string;
  };

  // Step 2: the candidate pool (proposal §5) — household scoping comes
  // from RLS on every read here, not an explicit filter. Deliberately
  // unsliced: scoreCandidates applies computeDeckSize internally, so
  // slicing here too would double-apply it.
  let candidateRecipeIds: string[];
  let thisWeekRecipeIds: Set<string>;
  try {
    const [eligibleRecipeIds, fetchedThisWeekRecipeIds] = await Promise.all([
      fetchEligibleRecipeIds(supabase),
      fetchCurrentThisWeekRecipeIds(supabase),
    ]);
    thisWeekRecipeIds = fetchedThisWeekRecipeIds;
    candidateRecipeIds = eligibleRecipeIds.filter((id) => !thisWeekRecipeIds.has(id));
  } catch (error) {
    // The round stays pending_candidates — recoverable by retry
    // (decision 1a), never manually cleaned up here.
    return jsonResponse(
      {
        error: `Round ${roundId} was created but candidate generation failed: ${errorMessage(error)}`,
        roundId,
      },
      502,
    );
  }

  if (candidateRecipeIds.length === 0) {
    return jsonResponse(
      {
        error: `Round ${roundId} was created, but no eligible recipes are available for a deck.`,
        roundId,
      },
      422,
    );
  }

  // Step 3: Smart Selection v1 (ADR-0027 decision 5) — gather the
  // aggregates scoreCandidates needs, then rank/diversify.
  let candidates: { recipe_id: string; score: number; reason_codes: string[] }[];
  try {
    const [candidateSnapshots, thisWeekContext] = await Promise.all([
      buildCandidateSnapshots(supabase, candidateRecipeIds, roundId),
      fetchThisWeekTagsAndCategoryKeys(supabase, [...thisWeekRecipeIds]),
    ]);

    const ranked = scoreCandidates({
      roundId,
      now: new Date(),
      targetCount: parsed.targetCount,
      candidates: candidateSnapshots,
      thisWeekTags: thisWeekContext.tags,
      thisWeekCategoryKeys: thisWeekContext.categoryKeys,
    });

    candidates = ranked.map((r) => ({
      recipe_id: r.recipeId,
      score: r.score,
      reason_codes: r.reasonCodes,
    }));
  } catch (error) {
    // Same recoverable-by-retry posture as the pool read above — scoring
    // failing partway through leaves the round pending_candidates, not
    // half-finalized.
    return jsonResponse(
      {
        error: `Round ${roundId} was created but candidate scoring failed: ${errorMessage(error)}`,
        roundId,
      },
      502,
    );
  }

  // Step 4: write the deck and activate the round, fenced by claimToken
  // exactly like finalize_import_job (ADR-0020/ADR-0027 decision 1a).
  const { data: finalized, error: finalizeError } = await supabase
    .rpc('finalize_selection_round_candidates', {
      round_id: roundId,
      claim_token: claimToken,
      candidates,
      strategy_version: STRATEGY_VERSION,
    })
    .single();

  if (finalizeError || !finalized) {
    const message = finalizeError?.message ?? 'Could not finalize the selection round';
    // Round is left pending_candidates by design (decision 1a) — no
    // cleanup call exists or should exist here.
    const status = /not found|claim/.test(message) ? 409 : 502;
    return jsonResponse(
      { error: `Round ${roundId} was created but could not be finalized: ${message}`, roundId },
      status,
    );
  }

  return jsonResponse({ roundId, candidateCount: candidates.length }, 200);
});
