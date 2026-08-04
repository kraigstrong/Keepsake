import type { LibraryRecipe } from '../sync/offlineRecipes';

/**
 * prd.md §14's "Additional sorts" minus Frequently Selected — that tier
 * needs a planned count that doesn't exist until Phase 12's This Week
 * planning, and its storage shape isn't decided yet (ADR-0014). Omitted
 * from the type entirely rather than exposed-but-broken.
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

/**
 * prd.md §14 default sort: Recently Added (<2wk) first — newest first
 * within that tier — then the remaining recipes alphabetically. The PRD
 * doesn't specify remaining's order; alphabetical is already one of the
 * other offered sorts, so it's a principled choice, not an arbitrary one
 * (ADR-0014). The third tier, Frequently Selected, is a known, tracked
 * gap (see SortMode above) — not guessed at.
 */
function smartSort(recipes: LibraryRecipe[], now: Date): LibraryRecipe[] {
  const cutoff = now.getTime() - TWO_WEEKS_MS;
  const recentlyAdded: LibraryRecipe[] = [];
  const remaining: LibraryRecipe[] = [];

  for (const recipe of recipes) {
    if (new Date(recipe.createdAt).getTime() >= cutoff) {
      recentlyAdded.push(recipe);
    } else {
      remaining.push(recipe);
    }
  }

  recentlyAdded.sort(byCreatedAtDescending);
  remaining.sort(byTitle);
  return [...recentlyAdded, ...remaining];
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
