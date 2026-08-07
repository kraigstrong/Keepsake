import type { LibraryRecipe } from '../sync/offlineRecipes';

/**
 * prd.md §14's "Additional sorts". Frequently Selected (FREQ-01) isn't
 * a selectable mode of its own — like Recently Added, it's a tier
 * *within* Smart sort (see smartSort below), not something a user picks
 * independently.
 */
export type SortMode = 'smart' | 'alphabetical' | 'recentlyAdded';

export const SORT_MODES: readonly SortMode[] = ['smart', 'alphabetical', 'recentlyAdded'];

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function byTitle(a: LibraryRecipe, b: LibraryRecipe): number {
  return a.title.localeCompare(b.title);
}

// ISO 8601 timestamps sort correctly as plain strings (same-format,
// zero-padded, UTC) — no need to parse to Date for ordering.
function byCreatedAtDescending(a: LibraryRecipe, b: LibraryRecipe): number {
  return b.createdAt.localeCompare(a.createdAt);
}

// Higher plannedCount first; ties broken alphabetically for a
// deterministic, stable order rather than leaving equal-count recipes
// in whatever order they happened to arrive in.
function byPlannedCountDescending(a: LibraryRecipe, b: LibraryRecipe): number {
  return b.plannedCount - a.plannedCount || byTitle(a, b);
}

/**
 * prd.md §14 default sort, three tiers, each recipe appearing in
 * exactly one: Recently Added (<2wk, newest first) — unchanged from
 * Phase 7 — then Frequently Selected (FREQ-01: plannedCount > 0, most-
 * planned first) among whatever's left, then everything else
 * alphabetically. A recipe added within the last two weeks appears in
 * Recently Added even if it's also been planned, so recency always
 * outranks planned count rather than the two tiers fighting over it.
 */
function smartSort(recipes: LibraryRecipe[], now: Date): LibraryRecipe[] {
  const cutoff = now.getTime() - TWO_WEEKS_MS;
  const recentlyAdded: LibraryRecipe[] = [];
  const frequentlySelected: LibraryRecipe[] = [];
  const remaining: LibraryRecipe[] = [];

  for (const recipe of recipes) {
    if (new Date(recipe.createdAt).getTime() >= cutoff) {
      recentlyAdded.push(recipe);
    } else if (recipe.plannedCount > 0) {
      frequentlySelected.push(recipe);
    } else {
      remaining.push(recipe);
    }
  }

  recentlyAdded.sort(byCreatedAtDescending);
  frequentlySelected.sort(byPlannedCountDescending);
  remaining.sort(byTitle);
  return [...recentlyAdded, ...frequentlySelected, ...remaining];
}

/** Pure — no SQLite/AsyncStorage dependency, fully unit testable. `now` is injectable so the <2wk cutoff is deterministic in tests. */
export function sortRecipes(
  recipes: LibraryRecipe[],
  mode: SortMode,
  now: Date = new Date(),
): LibraryRecipe[] {
  switch (mode) {
    case 'alphabetical':
      return [...recipes].sort(byTitle);
    case 'recentlyAdded':
      return [...recipes].sort(byCreatedAtDescending);
    case 'smart':
      return smartSort(recipes, now);
  }
}
