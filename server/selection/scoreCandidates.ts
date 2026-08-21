/**
 * Deterministic Smart Selection v1 ranking (`docs/proposals/smart-meal-
 * selection-architecture.md` §5, ADR-0027 for everything round-lifecycle
 * — this module implements only the scoring/diversification content §5
 * still owns). Pure, database-free, and runtime-neutral so it can be
 * unit-tested under Node (Jest) despite executing inside the Deno Edge
 * Function that orchestrates a round at runtime — mirrors
 * `server/units/parseQuantity.ts`'s convention: no Supabase import, no
 * I/O, no side effects at import time.
 *
 * The caller (the Edge Function) owns eligibility filtering (household
 * match, not archived/deleted, not already in the current weekly plan)
 * and every database read. This module only ranks and diversifies a
 * snapshot it's handed — it must not know rows or a database exist.
 */

/** One eligible recipe plus its precomputed aggregates, as read by the caller. */
export interface CandidateRecipeSnapshot {
  recipeId: string;
  /** Free-form `recipes.tags`. */
  tags: string[];
  /**
   * Group-qualified category keys — `"protein:Beef"`, `"dish_type:Soup"` —
   * built by the caller from `categories.group_name` and `categories.value`.
   *
   * Must be qualified, not the bare `group_name`. `group_name` is
   * constrained to exactly three values (`protein`/`dish_type`/
   * `preparation`, see `20260803100000_recipe_schema.sql`), so ranking on
   * it alone makes a beef dish and a fish dish look identical, applies the
   * overlap penalty near-uniformly across every candidate, and makes a
   * reason like "the only fish in the deck" unrepresentable. Qualifying
   * with `value` is what gives category diversification any signal at all.
   * Including the group keeps two identically-named values on different
   * axes from colliding.
   */
  categoryKeys: string[];
  /** True iff no `planning_entries` row has ever existed for this recipe. */
  neverPlanned: boolean;
  /**
   * The more recent of last-planned and last-cooked, as an ISO-8601
   * timestamp, or null if the recipe has no planning or cooking history
   * at all. Note this is independent of `neverPlanned`: a recipe can
   * have been cooked (via `cooking_events`) without ever having been
   * formally planned.
   */
  lastActivityAt: string | null;
  /** `recipes.planned_count`. */
  plannedCount: number;
  /**
   * How many of this household's last 1–2 candidate decks this recipe
   * already appeared in (deck membership only — never swipe outcomes;
   * that boundary is a settled product decision, not an implementation
   * detail, per §5/§12 of the proposal).
   */
  recentDeckAppearances: number;
}

export interface ScoreCandidatesInput {
  /** The round this deck is being generated for — feeds the tie-break hash. */
  roundId: string;
  /** Reference time recency is scored against. */
  now: string | Date;
  /** "Meals to find" target the deck size scales off (defaults to 4 upstream). */
  targetCount: number;
  candidates: CandidateRecipeSnapshot[];
  /** Tags present on recipes already in the household's current This Week plan. */
  thisWeekTags: string[];
  /** Group-qualified category keys already in the household's current This Week plan, same form as above. */
  thisWeekCategoryKeys: string[];
}

/**
 * Up to two per candidate, in priority order, per §5: the never-planned/
 * resurfaced signal first (directly serves the resurfacing product goal),
 * then diversity, then this-week variety. Picking which true facts to
 * mention — no generation, no LLM.
 */
export type ReasonCode = 'never_planned' | 'resurfaced' | 'diversity' | 'this_week_variety';

export interface RankedCandidate {
  recipeId: string;
  /** Final score after diversification adjustments — useful for debugging/tests, not a contract. */
  score: number;
  reasonCodes: ReasonCode[];
}

// --- Weights -----------------------------------------------------------
//
// Relative ordering (all are named constants so a future v2 can retune
// without touching logic, per §5's `candidate_strategy_version` intent):
//
//   NEVER_PLANNED_BONUS (100)  >>  RECENCY_PENALTY_MAX (15)
//                              >   THIS_WEEK_OVERLAP_PENALTY (10) / axis
//                              >   DIVERSITY_OVERLAP_PENALTY (6) / axis
//                              >   STALENESS_PENALTY (4/appearance, capped at 2)
//                              >>  ENGAGEMENT max contribution (5)
//
// never_planned dominates by roughly an order of magnitude, per §5's
// explicit instruction that it "directly serves the resurfacing goal"
// and that engagement must be "weighted low relative to never_planned"
// so popularity never fights that goal. Recency and the two overlap
// penalties are all "small" per §5's own wording, but recency is scored
// slightly higher than diversity/this-week overlap because it is the
// most direct proxy for "was this just cooked" — the thing goal 2 most
// wants to counteract. This-week overlap outweighs generic within-deck
// diversity because §5 calls it out as an *additional* deprioritization
// on top of diversity, not a peer of it. Anti-staleness is deliberately
// the mildest of the deprioritizing signals ("mildly deprioritize, never
// exclude"). Engagement is the smallest signal by construction — a
// tie-breaker, not a driver.
const NEVER_PLANNED_BONUS = 100;
const RECENCY_LOOKBACK_DAYS = 21;
const RECENCY_PENALTY_MAX = 15;
const ENGAGEMENT_WEIGHT = 0.5;
const ENGAGEMENT_PLAN_CAP = 10; // planned_count above this contributes no more
const DIVERSITY_OVERLAP_PENALTY = 6; // per shared tag/category-group already in the deck-so-far
const THIS_WEEK_OVERLAP_PENALTY = 10; // per shared tag/category-group already in current This Week
const STALENESS_PENALTY_PER_APPEARANCE = 4;
const STALENESS_APPEARANCE_CAP = 2; // "last 1-2 candidate decks" per §5

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `clamp(target_count * 3, 8, 24)`, per §5 — defaults to 12 at the default target of 4. */
export function computeDeckSize(targetCount: number): number {
  return Math.min(24, Math.max(8, targetCount * 3));
}

// FNV-1a 32-bit — deterministic, dependency-free (no Node `crypto`, which
// wouldn't be available under Deno anyway), safe under both runtimes.
// Used only for a stable tie-break order, never as a security hash.
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function daysSince(iso: string, nowDate: Date): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (nowDate.getTime() - then) / MS_PER_DAY;
}

// Small negative weight inside the lookback window, decaying linearly
// from full penalty at "now" to zero at the window edge, and fully
// neutral (0) outside it — per §5. A candidate with no activity history,
// or a malformed timestamp, is never penalized (nothing to penalize).
function recencyPenalty(lastActivityAt: string | null, nowDate: Date): number {
  if (lastActivityAt === null) return 0;
  const days = daysSince(lastActivityAt, nowDate);
  if (days === null || days < 0 || days >= RECENCY_LOOKBACK_DAYS) return 0;
  const fraction = 1 - days / RECENCY_LOOKBACK_DAYS;
  return -RECENCY_PENALTY_MAX * fraction;
}

function engagementScore(plannedCount: number): number {
  const clamped = Math.min(Math.max(plannedCount, 0), ENGAGEMENT_PLAN_CAP);
  return ENGAGEMENT_WEIGHT * clamped;
}

function stalenessPenalty(recentDeckAppearances: number): number {
  const clamped = Math.min(Math.max(recentDeckAppearances, 0), STALENESS_APPEARANCE_CAP);
  return -STALENESS_PENALTY_PER_APPEARANCE * clamped;
}

function baseScore(candidate: CandidateRecipeSnapshot, nowDate: Date): number {
  let score = 0;
  if (candidate.neverPlanned) score += NEVER_PLANNED_BONUS;
  score += recencyPenalty(candidate.lastActivityAt, nowDate);
  score += engagementScore(candidate.plannedCount);
  return score;
}

// 'never_planned' takes priority over 'resurfaced' when both facts are
// true (e.g. cooked once via cooking_events but never formally planned)
// since it's the stronger, more specific signal. 'resurfaced' covers a
// candidate with real history that's gone stale enough (at or past the
// lookback window) to be worth surfacing again. A candidate with recent
// activity inside the window has no resurfacing story to tell yet, and
// an unknown timestamp makes no claim either way — same "don't guess
// when uncertain" posture AGENTS.md requires of AI-derived data, applied
// here to a score explanation instead.
function tier1Signal(
  candidate: CandidateRecipeSnapshot,
  nowDate: Date,
): 'never_planned' | 'resurfaced' | null {
  if (candidate.neverPlanned) return 'never_planned';
  if (candidate.lastActivityAt === null) return null;
  const days = daysSince(candidate.lastActivityAt, nowDate);
  if (days === null) return null;
  if (days < 0) return null; // malformed/future timestamp — no claim made
  return days >= RECENCY_LOOKBACK_DAYS ? 'resurfaced' : null;
}

function overlapCount(attrs: readonly string[], against: ReadonlySet<string>): number {
  let count = 0;
  for (const attr of attrs) {
    if (against.has(attr)) count++;
  }
  return count;
}

// Weighted by how many times an attribute was already picked, not merely
// whether it appeared: set membership makes the second Beef cost what the
// eighth does, and the greedy pass stops rotating. See the round-robin
// tests in scoreCandidates.test.ts.
function weightedOverlap(attrs: readonly string[], against: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const attr of attrs) total += against.get(attr) ?? 0;
  return total;
}

function recordPicked(attrs: readonly string[], into: Map<string, number>): void {
  for (const attr of attrs) into.set(attr, (into.get(attr) ?? 0) + 1);
}

// Recipes with no tags and no categories get neither bonus nor penalty
// here by construction: an empty `attrs` array can never overlap with
// anything, so this returns 0 regardless of what's already chosen or
// already in This Week — never exclude something for sparse metadata.
function hasMetadata(candidate: CandidateRecipeSnapshot): boolean {
  return candidate.tags.length > 0 || candidate.categoryKeys.length > 0;
}

interface ScoredCandidate {
  candidate: CandidateRecipeSnapshot;
  base: number;
  tier1: 'never_planned' | 'resurfaced' | null;
  /** True iff this candidate shares no tag/category-group with the current This Week plan. */
  variesFromThisWeek: boolean;
  tieBreak: number;
}

/**
 * Ranks and diversifies an already-eligible candidate snapshot into a
 * deck-sized, reason-coded list. A single greedy pass: candidates are
 * considered in base-score order, and each pick is chosen by an
 * adjusted score that penalizes overlap with tags/category-groups
 * already placed earlier in this same deck (this is the "round-robin
 * across tags and category group_name" of §5 — a shared-penalty greedy
 * selection achieves the same "don't let one tag dominate" effect as a
 * literal per-axis round-robin scheduler, without the extra bookkeeping
 * a deck of 8-24 doesn't need) and with what's already in This Week.
 * Anti-staleness and engagement are flat per-candidate penalties/bonuses
 * that don't depend on pick order.
 */
export function scoreCandidates(input: ScoreCandidatesInput): RankedCandidate[] {
  const nowDate = typeof input.now === 'string' ? new Date(input.now) : input.now;
  const deckSize = computeDeckSize(input.targetCount);
  const thisWeekTagSet = new Set(input.thisWeekTags);
  const thisWeekCategoryKeySet = new Set(input.thisWeekCategoryKeys);
  // If This Week is currently empty there's nothing to have varied from —
  // avoid awarding a vacuous "this_week_variety" to every candidate.
  const thisWeekHasContent = thisWeekTagSet.size > 0 || thisWeekCategoryKeySet.size > 0;

  const remaining: ScoredCandidate[] = input.candidates.map((candidate) => {
    const thisWeekOverlap =
      overlapCount(candidate.tags, thisWeekTagSet) +
      overlapCount(candidate.categoryKeys, thisWeekCategoryKeySet);
    return {
      candidate,
      base:
        baseScore(candidate, nowDate) +
        stalenessPenalty(candidate.recentDeckAppearances) -
        THIS_WEEK_OVERLAP_PENALTY * thisWeekOverlap,
      tier1: tier1Signal(candidate, nowDate),
      variesFromThisWeek: thisWeekHasContent && hasMetadata(candidate) && thisWeekOverlap === 0,
      tieBreak: stableHash(`${input.roundId}:${candidate.recipeId}`),
    };
  });

  // Occurrence counts, not membership — see weightedOverlap.
  const chosenTags = new Map<string, number>();
  const chosenCategoryKeys = new Map<string, number>();
  const result: RankedCandidate[] = [];

  while (remaining.length > 0 && result.length < deckSize) {
    let best: ScoredCandidate | null = null;
    let bestAdjusted = -Infinity;
    let bestDeckOverlap = 0;

    for (const entry of remaining) {
      const deckOverlap =
        weightedOverlap(entry.candidate.tags, chosenTags) +
        weightedOverlap(entry.candidate.categoryKeys, chosenCategoryKeys);
      const adjusted = entry.base - DIVERSITY_OVERLAP_PENALTY * deckOverlap;

      if (
        best === null ||
        adjusted > bestAdjusted ||
        (adjusted === bestAdjusted && entry.tieBreak > best.tieBreak)
      ) {
        best = entry;
        bestAdjusted = adjusted;
        bestDeckOverlap = deckOverlap;
      }
    }

    // best is guaranteed non-null: the loop only runs while remaining.length > 0.
    const picked = best as ScoredCandidate;
    remaining.splice(remaining.indexOf(picked), 1);

    // Same "nothing to have varied from yet" guard as this-week variety,
    // applied to the deck itself: captured before this pick's own tags
    // are folded in below, so a deck seeded entirely by sparse-metadata
    // picks doesn't retroactively credit the next pick with diversity.
    const deckHadContent = chosenTags.size > 0 || chosenCategoryKeys.size > 0;
    recordPicked(picked.candidate.tags, chosenTags);
    recordPicked(picked.candidate.categoryKeys, chosenCategoryKeys);

    const addsDiversity = deckHadContent && hasMetadata(picked.candidate) && bestDeckOverlap === 0;

    const reasonCodes: ReasonCode[] = [];
    if (picked.tier1) reasonCodes.push(picked.tier1);
    if (addsDiversity) reasonCodes.push('diversity');
    if (picked.variesFromThisWeek) reasonCodes.push('this_week_variety');

    result.push({
      recipeId: picked.candidate.recipeId,
      score: bestAdjusted,
      reasonCodes: reasonCodes.slice(0, 2),
    });
  }

  return result;
}
