import type { LibraryRecipe } from '../sync/offlineRecipes';

/**
 * prd.md §12: multiple category selections allowed, OR'd together within
 * that one facet ("Chicken or Beef"). Tags are deliberately not a filter
 * facet (developer product decision, 2026-08-07) — free-form AI-suggested
 * tags fragment too fast to make a useful filter vocabulary (five recipes
 * already produced an unwieldy chip list); they remain fully searchable
 * (SRCH-01) instead, which is where a specific, remembered tag is
 * actually findable without browsing an ever-growing chip wall.
 */
export interface LibraryFilters {
  categoryIds: string[];
}

export const EMPTY_FILTERS: LibraryFilters = { categoryIds: [] };

/** LIB-04: the count shown on the filter sheet's badge. */
export function activeFilterCount(filters: LibraryFilters): number {
  return filters.categoryIds.length;
}

export function filterRecipes(recipes: LibraryRecipe[], filters: LibraryFilters): LibraryRecipe[] {
  if (activeFilterCount(filters) === 0) return recipes;

  return recipes.filter(
    (recipe) =>
      filters.categoryIds.length === 0 ||
      filters.categoryIds.some((id) => recipe.categoryIds.includes(id)),
  );
}

function toggle<T>(selected: T[], value: T): T[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

export function toggleCategoryFilter(filters: LibraryFilters, categoryId: string): LibraryFilters {
  return { ...filters, categoryIds: toggle(filters.categoryIds, categoryId) };
}
