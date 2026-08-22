/**
 * select-candidates Edge Function (ADR-0027 decision 5): orchestrates a
 * selection round's two-commit creation path — create_selection_round,
 * then finalize_selection_round_candidates — with the candidate
 * eligibility filter (`docs/proposals/smart-meal-selection-
 * architecture.md` §5) run in between. Same caller's-JWT/no-service-role
 * boundary `import-recipe` uses (ADR-0015): every read here is RLS-
 * scoped exactly like an ordinary client call.
 *
 * This PR ships the filter only, not the ranking heuristic (roadmap:
 * walkable skeleton before smart ranking) — every candidate gets a
 * placeholder score and no reason codes, and candidate_strategy_version
 * is set to 'filter-only-v1' (never 'heuristic-v1') so a future reader
 * can tell which rounds were never actually scored.
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

import { computeDeckSize } from '../../../server/selection/scoreCandidates.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Matches the proposal §5 example ("target 4 -> deck of 12") — the
// client can override, but a round started without one still gets a
// sane deck rather than computeDeckSize(null) blowing up.
const DEFAULT_TARGET_COUNT = 4;

const STRATEGY_VERSION = 'filter-only-v1';

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

// Ordered by primary key (not created_at) for a deterministic pool with
// no possible tie — this PR's whole "ranking" is this fixed order plus
// the This Week exclusion below; real scoring lands in a later PR.
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
      return jsonResponse(
        { error: 'a selection round is already in progress for this household' },
        409,
      );
    }
    return jsonResponse({ error: message }, 400);
  }

  const { round_id: roundId, claim_token: claimToken } = created as {
    round_id: string;
    claim_token: string;
  };

  // Step 2: the candidate filter (proposal §5) — the only selection
  // logic this PR ships. household scoping comes from RLS on both
  // reads, not an explicit filter.
  let candidateRecipeIds: string[];
  try {
    const [eligibleRecipeIds, thisWeekRecipeIds] = await Promise.all([
      fetchEligibleRecipeIds(supabase),
      fetchCurrentThisWeekRecipeIds(supabase),
    ]);
    candidateRecipeIds = eligibleRecipeIds
      .filter((id) => !thisWeekRecipeIds.has(id))
      .slice(0, computeDeckSize(parsed.targetCount));
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

  // score/reason_codes are non-null columns with no real content yet
  // (file header) — a stable placeholder, not a claim about ranking.
  const candidates = candidateRecipeIds.map((recipeId) => ({
    recipe_id: recipeId,
    score: 0,
    reason_codes: [] as string[],
  }));

  // Step 3: write the deck and activate the round, fenced by claimToken
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
