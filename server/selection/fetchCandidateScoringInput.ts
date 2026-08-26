/**
 * Household-scoped Supabase reads that gather `scoreCandidates.ts`'s
 * input (ADR-0027 decision 5, `docs/proposals/smart-meal-selection-
 * architecture.md` §5). Kept out of `scoreCandidates.ts` itself, which
 * must stay database-free (see that file's header) — this module is the
 * opposite: it only does I/O, dependency-injected with a
 * caller's-JWT-scoped `SupabaseClient` so RLS applies exactly as it does
 * to every other read in `select-candidates`'s Edge Function (no
 * service-role, no new trust boundary). Runtime-neutral like
 * `server/import/secureFetch.ts` — no Deno-specific globals, importable
 * with an explicit `.ts` extension from the Edge Function and without
 * one from Jest.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CandidateRecipeSnapshot } from './scoreCandidates.ts';

interface RecipeCoreRow {
  id: string;
  tags: string[];
  planned_count: number;
}

interface RecipeCore {
  tags: string[];
  plannedCount: number;
}

/** `recipes.tags`/`recipes.planned_count` for a batch of ids, one `.in()` read. */
async function fetchRecipeCore(
  supabase: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, RecipeCore>> {
  const map = new Map<string, RecipeCore>();
  if (recipeIds.length === 0) return map;

  const { data, error } = await supabase
    .from('recipes')
    .select('id, tags, planned_count')
    .in('id', recipeIds);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as RecipeCoreRow[]) {
    map.set(row.id, { tags: row.tags, plannedCount: row.planned_count });
  }
  return map;
}

interface RecipeCategoryRow {
  recipe_id: string;
  categories:
    { group_name: string; value: string } | { group_name: string; value: string }[] | null;
}

/**
 * Group-qualified `"group_name:value"` keys per recipe, one join read
 * (`recipe_categories` -> `categories`) batched for the whole id set.
 * See `CandidateRecipeSnapshot.categoryKeys`'s JSDoc for why qualified,
 * not bare `group_name`.
 */
async function fetchCategoryKeysByRecipe(
  supabase: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (recipeIds.length === 0) return map;

  const { data, error } = await supabase
    .from('recipe_categories')
    .select('recipe_id, categories(group_name, value)')
    .in('recipe_id', recipeIds);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as RecipeCategoryRow[]) {
    // A many-to-one FK embed (recipe_categories.category_id -> categories.id)
    // is a single object under supabase-js, but tolerate an array shape too
    // rather than assume the client library's embed convention never changes.
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    if (!category) continue;
    const key = `${category.group_name}:${category.value}`;
    const existing = map.get(row.recipe_id);
    if (existing) existing.push(key);
    else map.set(row.recipe_id, [key]);
  }
  return map;
}

/**
 * Last `created_at` per recipe with at least one `planning_entries` row
 * (any status/plan, not just `counted` — existence of planning history,
 * not FREQ-01's counted semantics). A recipe id absent from the returned
 * map has never been planned.
 *
 * Ordered newest-first (Codex, PR #102): unlike `fetchRecipeCore`/
 * `fetchCategoryKeysByRecipe`, whose row count is bounded by
 * `recipeIds.length` and a small per-recipe category count, this table's
 * row count per recipe grows with the household's cumulative planning
 * history and isn't bounded by deck size. PostgREST's `api.max_rows`
 * (1000, `supabase/config.toml`) silently truncates past that — ordering
 * newest-first means a truncation only ever drops older rows, so the
 * true "last planned" timestamp is still captured for any recipe with at
 * least one row in the kept page. A recipe whose *only* planning history
 * is older than 1000 more-recent rows across the other candidates in
 * this same deck would still be misread as never-planned; true full
 * correctness needs per-recipe aggregation server-side, which is more
 * than this app's friends-and-family scale (`docs/roadmap.md`) warrants
 * today.
 */
async function fetchLastPlannedAt(
  supabase: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (recipeIds.length === 0) return map;

  const { data, error } = await supabase
    .from('planning_entries')
    .select('recipe_id, created_at')
    .in('recipe_id', recipeIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { recipe_id: string; created_at: string }[]) {
    const existing = map.get(row.recipe_id);
    if (!existing || new Date(row.created_at) > new Date(existing)) {
      map.set(row.recipe_id, row.created_at);
    }
  }
  return map;
}

/**
 * Last `cooked_at` per recipe with at least one `cooking_events` row.
 * Ordered newest-first for the same `api.max_rows` truncation reason as
 * `fetchLastPlannedAt` above.
 */
async function fetchLastCookedAt(
  supabase: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (recipeIds.length === 0) return map;

  const { data, error } = await supabase
    .from('cooking_events')
    .select('recipe_id, cooked_at')
    .in('recipe_id', recipeIds)
    .order('cooked_at', { ascending: false });
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as { recipe_id: string; cooked_at: string }[]) {
    const existing = map.get(row.recipe_id);
    if (!existing || new Date(row.cooked_at) > new Date(existing)) {
      map.set(row.recipe_id, row.cooked_at);
    }
  }
  return map;
}

/** The more recent of two nullable ISO timestamps, or whichever is non-null. */
export function mostRecentIso(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

/**
 * How many of the household's most recent 1-2 *prior* selection rounds
 * (by `created_at desc`, excluding `excludeRoundId` — the round just
 * created in this same request) each candidate recipe id already
 * appeared in. Deck membership only (`selection_round_candidates`), never
 * swipe/decision outcomes, per the architecture doc §5/§12. Two reads:
 * the prior round ids first (so "1-2 rounds" is rounds, not rows), then
 * one batched candidate-row read across both.
 */
export async function fetchRecentDeckAppearances(
  supabase: SupabaseClient,
  recipeIds: string[],
  excludeRoundId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (recipeIds.length === 0) return counts;

  const { data: priorRounds, error: roundsError } = await supabase
    .from('selection_rounds')
    .select('id')
    .neq('id', excludeRoundId)
    .order('created_at', { ascending: false })
    .limit(2);
  if (roundsError) throw new Error(roundsError.message);

  const priorRoundIds = ((priorRounds ?? []) as { id: string }[]).map((r) => r.id);
  if (priorRoundIds.length === 0) return counts;

  const { data: rows, error: rowsError } = await supabase
    .from('selection_round_candidates')
    .select('recipe_id')
    .in('round_id', priorRoundIds)
    .in('recipe_id', recipeIds);
  if (rowsError) throw new Error(rowsError.message);

  // unique(round_id, recipe_id) on selection_round_candidates means each
  // prior round contributes at most one row per recipe id, so a plain
  // row count already equals "how many of these rounds included it."
  for (const row of (rows ?? []) as { recipe_id: string }[]) {
    counts.set(row.recipe_id, (counts.get(row.recipe_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Tags/category keys already present on This Week's current plan
 * (`ScoreCandidatesInput.thisWeekTags`/`thisWeekCategoryKeys`) — same
 * qualification rule as `CandidateRecipeSnapshot.categoryKeys`. Flat,
 * possibly-duplicated arrays are fine: `scoreCandidates` sets-ifies them.
 */
export async function fetchThisWeekTagsAndCategoryKeys(
  supabase: SupabaseClient,
  thisWeekRecipeIds: string[],
): Promise<{ tags: string[]; categoryKeys: string[] }> {
  if (thisWeekRecipeIds.length === 0) return { tags: [], categoryKeys: [] };

  const [core, categoryKeysByRecipe] = await Promise.all([
    fetchRecipeCore(supabase, thisWeekRecipeIds),
    fetchCategoryKeysByRecipe(supabase, thisWeekRecipeIds),
  ]);

  const tags: string[] = [];
  const categoryKeys: string[] = [];
  for (const recipeId of thisWeekRecipeIds) {
    tags.push(...(core.get(recipeId)?.tags ?? []));
    categoryKeys.push(...(categoryKeysByRecipe.get(recipeId) ?? []));
  }
  return { tags, categoryKeys };
}

/**
 * Builds one `CandidateRecipeSnapshot` per id in `recipeIds` — the
 * per-candidate half of `scoreCandidates`'s input (the other half is
 * `fetchThisWeekTagsAndCategoryKeys`). Five reads, batched with `.in()`
 * and run in parallel, never one query per recipe.
 */
export async function buildCandidateSnapshots(
  supabase: SupabaseClient,
  recipeIds: string[],
  roundId: string,
): Promise<CandidateRecipeSnapshot[]> {
  if (recipeIds.length === 0) return [];

  const [core, categoryKeysByRecipe, lastPlannedAt, lastCookedAt, recentDeckAppearances] =
    await Promise.all([
      fetchRecipeCore(supabase, recipeIds),
      fetchCategoryKeysByRecipe(supabase, recipeIds),
      fetchLastPlannedAt(supabase, recipeIds),
      fetchLastCookedAt(supabase, recipeIds),
      fetchRecentDeckAppearances(supabase, recipeIds, roundId),
    ]);

  return recipeIds.map((recipeId) => {
    const plannedAt = lastPlannedAt.get(recipeId) ?? null;
    return {
      recipeId,
      tags: core.get(recipeId)?.tags ?? [],
      categoryKeys: categoryKeysByRecipe.get(recipeId) ?? [],
      neverPlanned: !lastPlannedAt.has(recipeId),
      lastActivityAt: mostRecentIso(plannedAt, lastCookedAt.get(recipeId) ?? null),
      plannedCount: core.get(recipeId)?.plannedCount ?? 0,
      recentDeckAppearances: recentDeckAppearances.get(recipeId) ?? 0,
    };
  });
}
