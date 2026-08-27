import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '../supabase/instance';

export type SelectionRoundMode = 'solo' | 'group';

export type SelectionRoundStatus =
  'pending_candidates' | 'active' | 'ready_for_review' | 'applied' | 'cancelled';

export interface SelectionRoundParticipant {
  userId: string;
  completedAt: string | null;
}

export interface SelectionRoundCandidate {
  recipeId: string;
  score: number;
  reasonCodes: string[];
  /** Zero-based deck rank (`get_selection_round`'s `order by position`) — the deck's actual order. */
  position: number;
}

export interface SelectionRound {
  id: string;
  householdId: string;
  createdBy: string;
  mode: SelectionRoundMode;
  status: SelectionRoundStatus;
  targetCount: number | null;
  closesAt: string | null;
  /** Null until finalize_selection_round_candidates writes the deck (ADR-0027 decision 1a). */
  candidateStrategyVersion: string | null;
  revealedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  appliedWeeklyPlanId: string | null;
  participants: SelectionRoundParticipant[];
  candidates: SelectionRoundCandidate[];
}

// get_selection_round returns jsonb built from to_jsonb(selection_rounds
// row) merged with participants/candidates arrays — keys are the raw
// column names (snake_case), claim_token already stripped server-side.
interface SelectionRoundParticipantRow {
  user_id: string;
  completed_at: string | null;
}

interface SelectionRoundCandidateRow {
  recipe_id: string;
  score: number;
  reason_codes: string[];
  position: number;
}

interface SelectionRoundRow {
  id: string;
  household_id: string;
  created_by: string;
  mode: SelectionRoundMode;
  status: SelectionRoundStatus;
  target_count: number | null;
  closes_at: string | null;
  candidate_strategy_version: string | null;
  revealed_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  applied_at: string | null;
  applied_by: string | null;
  applied_weekly_plan_id: string | null;
  participants: SelectionRoundParticipantRow[];
  candidates: SelectionRoundCandidateRow[];
}

function mapSelectionRound(row: SelectionRoundRow): SelectionRound {
  return {
    id: row.id,
    householdId: row.household_id,
    createdBy: row.created_by,
    mode: row.mode,
    status: row.status,
    targetCount: row.target_count,
    closesAt: row.closes_at,
    candidateStrategyVersion: row.candidate_strategy_version,
    revealedAt: row.revealed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    appliedWeeklyPlanId: row.applied_weekly_plan_id,
    participants: row.participants.map((p) => ({
      userId: p.user_id,
      completedAt: p.completed_at,
    })),
    candidates: row.candidates.map((c) => ({
      recipeId: c.recipe_id,
      score: c.score,
      reasonCodes: c.reason_codes,
      position: c.position,
    })),
  };
}

export interface StartSelectionRoundRequest {
  mode: SelectionRoundMode;
  /** Ignored by the Edge Function/create_selection_round in solo mode. */
  participantUserIds?: string[];
  targetCount?: number;
  /** Required for group mode (create_selection_round rejects a missing/past deadline); ignored for solo. */
  closesAt?: string;
}

export interface StartSelectionRoundResult {
  roundId: string;
  candidateCount: number;
}

/**
 * Thin client wrapper over the select-candidates Edge Function
 * (ADR-0027 decision 5). `functions.invoke` forwards the current
 * session's JWT automatically, same as `submitImportJob` — the Edge
 * Function is not itself a trust boundary, RLS is.
 *
 * Every failure branch in the Edge Function returns a non-2xx status
 * (unlike import-recipe, which can return 200 with a stored failure for
 * a replayed job) — so `functions.invoke` always resolves those as
 * `error` here, never as a successful `data` payload to separately
 * check. A round can still be created but left un-finalized if the deck
 * step fails; the Edge Function embeds the round id in that error's
 * message text, not a structured field, so it's recoverable by retrying
 * this call (ADR-0027 decision 1a), not something this wrapper parses
 * out and cleans up itself.
 */
export async function startSelectionRound(
  request: StartSelectionRoundRequest,
): Promise<StartSelectionRoundResult> {
  const { data, error } = await supabase.functions.invoke('select-candidates', {
    body: request,
  });

  if (error) {
    // FunctionsHttpError is the one case where the function actually
    // ran — its .context carries our own { error } body, so surface
    // that message rather than a generic transport one.
    let specificMessage: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.clone().json()) as { error?: string };
        specificMessage = body.error;
      } catch {
        // response body wasn't JSON — fall through to the generic message
      }
    }
    throw new Error(specificMessage ?? error.message);
  }

  return data as StartSelectionRoundResult;
}

export interface RefillSelectionRoundResult {
  addedCount: number;
}

/**
 * "Select more" (ADR-0027 decision 2b): appends fresh candidates to an
 * already-`active` round's existing deck via the append branch of the
 * select-candidates Edge Function (`roundId` present, no `mode`). Client
 * name stays user-facing "refill" — only the RPC needed to avoid that
 * word, to leave it free for the eventual group-flow refill_selection_
 * round feature. Same error-unwrap shape as startSelectionRound:
 * addedCount: 0 (no eligible recipes left) is still success, not an
 * error the catch branch below would see.
 */
export async function refillSelectionRound(roundId: string): Promise<RefillSelectionRoundResult> {
  const { data, error } = await supabase.functions.invoke('select-candidates', {
    body: { roundId },
  });

  if (error) {
    let specificMessage: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.clone().json()) as { error?: string };
        specificMessage = body.error;
      } catch {
        // response body wasn't JSON — fall through to the generic message
      }
    }
    throw new Error(specificMessage ?? error.message);
  }

  return data as RefillSelectionRoundResult;
}

/**
 * Round + participants + deck in one call (get_selection_round is
 * SECURITY DEFINER and re-derives the caller's household itself, same
 * as every other round-scoped RPC — ADR-0027 decision 4 also means this
 * call resolves the round's auto-close before returning it).
 */
export async function getSelectionRound(roundId: string): Promise<SelectionRound> {
  const { data, error } = await supabase.rpc('get_selection_round', { round_id: roundId });
  if (error) throw new Error(error.message);
  return mapSelectionRound(data as SelectionRoundRow);
}

/** Open to any household member, not creator-only (ADR-0027 decision 3 — unlike closing). */
export async function cancelSelectionRound(roundId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_selection_round', { round_id: roundId });
  if (error) throw new Error(error.message);
}

/**
 * The household's current non-terminal round, or null. Backs recovery
 * after a lost `startSelectionRound` response — the round exists but the
 * client never received its id — and the "round in progress" entry point.
 * A plain RLS-scoped read: the partial unique index guarantees at most
 * one non-terminal round per household, so this cannot be ambiguous.
 */
export async function getActiveSelectionRound(): Promise<SelectionRound | null> {
  const { data, error } = await supabase
    .from('selection_rounds')
    .select('id')
    .in('status', ['pending_candidates', 'active', 'ready_for_review'])
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return getSelectionRound((data as { id: string }).id);
}

export type SelectionDecisionValue = 'yes' | 'no';

/** Backs the deck's Yes/Not-this-week controls and the swipe gesture's commit. */
export async function recordSelectionDecision(
  roundId: string,
  recipeId: string,
  decision: SelectionDecisionValue,
): Promise<void> {
  const { error } = await supabase.rpc('record_selection_decision', {
    round_id: roundId,
    recipe_id: recipeId,
    decision,
  });
  if (error) throw new Error(error.message);
}

/** Backs "undo" — reverts a decision to unseen (ADR-0027: absence, not a third stored value). */
export async function clearSelectionDecision(roundId: string, recipeId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_selection_decision', {
    round_id: roundId,
    recipe_id: recipeId,
  });
  if (error) throw new Error(error.message);
}

/** Creator-only; requires 'active' (ADR-0027 decision 3). Backs 1k's Add-to-This-Week CTA. */
export async function closeSelectionRound(roundId: string): Promise<void> {
  const { error } = await supabase.rpc('close_selection_round', { round_id: roundId });
  if (error) throw new Error(error.message);
}

export interface ApplySelectionRoundSelection {
  recipeId: string;
  multiplier: number;
}

/**
 * Requires 'ready_for_review' — idempotent no-op if already 'applied'
 * (ADR-0027 decision 6). Array order becomes insertion order into the
 * plan; archived/deleted/already-in-plan recipes are silently dropped,
 * a recipe_id that was never a candidate of this round is the one error.
 */
export async function applySelectionRound(
  roundId: string,
  weeklyPlanId: string,
  selections: ApplySelectionRoundSelection[],
): Promise<void> {
  const { error } = await supabase.rpc('apply_selection_round', {
    round_id: roundId,
    weekly_plan_id: weeklyPlanId,
    selections: selections.map((s) => ({ recipe_id: s.recipeId, multiplier: s.multiplier })),
  });
  if (error) throw new Error(error.message);
}

export interface SelectionDecisionRecord {
  decision: SelectionDecisionValue;
  /** `selection_decisions.decided_at` — what lets a resumed session reconstruct undo order. */
  decidedAt: string;
}

interface SelectionDecisionRow {
  recipe_id: string;
  decision: SelectionDecisionValue;
  decided_at: string;
}

/**
 * The caller's own decisions for a round, keyed by recipe id — what
 * makes resuming an in-progress round correct. `selection_decisions`'
 * RLS SELECT policy is `user_id = auth.uid() OR round revealed`
 * (ADR-0027 decision 2), so a participant's own decisions are always
 * readable here, even mid-round, well before the household-wide reveal
 * that policy's second clause covers. Carries `decidedAt` so a resumed
 * screen can rebuild its undo stack in the actual order decisions were
 * made, not just which recipes have one.
 */
export async function getMyDecisionsForRound(
  roundId: string,
  userId: string,
): Promise<Map<string, SelectionDecisionRecord>> {
  const { data, error } = await supabase
    .from('selection_decisions')
    .select('recipe_id, decision, decided_at')
    .eq('round_id', roundId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  const decisions = new Map<string, SelectionDecisionRecord>();
  ((data ?? []) as SelectionDecisionRow[]).forEach((row) => {
    decisions.set(row.recipe_id, { decision: row.decision, decidedAt: row.decided_at });
  });
  return decisions;
}
