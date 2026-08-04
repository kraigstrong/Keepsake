import type { LibraryRecipe } from '../sync/offlineRecipes';

/**
 * prd.md §12: multiple category/tag selections allowed. Within one facet
 * (all selected categories, or all selected tags) selections are OR'd —
 * "Chicken or Beef" — but the two facets are AND'd together, the
 * standard faceted-filter convention and the one most legible as a
 * "narrow the results" UI (each additional facet only ever shrinks the
 * result set, never grows it).
 */
export interface LibraryFilters {
  categoryIds: string[];
  tags: string[];
}

export const EMPTY_FILTERS: LibraryFilters = { categoryIds: [], tags: [] };

/** LIB-04: the count shown on the filter sheet's badge. */
export function activeFilterCount(filters: LibraryFilters): number {
  return filters.categoryIds.length + filters.tags.length;
}

export function filterRecipes(recipes: LibraryRecipe[], filters: LibraryFilters): LibraryRecipe[] {
  if (activeFilterCount(filters) === 0) return recipes;

  return recipes.filter((recipe) => {
    const matchesCategory =
      filters.categoryIds.length === 0 ||
      filters.categoryIds.some((id) => recipe.categoryIds.includes(id));
    const matchesTag =
      filters.tags.length === 0 || filters.tags.some((tag) => recipe.tags.includes(tag));
    return matchesCategory && matchesTag;
  });
}

function toggle<T>(selected: T[], value: T): T[] {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

export function toggleCategoryFilter(filters: LibraryFilters, categoryId: string): LibraryFilters {
  return { ...filters, categoryIds: toggle(filters.categoryIds, categoryId) };
}

export function toggleTagFilter(filters: LibraryFilters, tag: string): LibraryFilters {
  return { ...filters, tags: toggle(filters.tags, tag) };
}
