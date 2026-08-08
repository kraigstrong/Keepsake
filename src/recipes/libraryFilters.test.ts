import {
  activeFilterCount,
  EMPTY_FILTERS,
  filterRecipes,
  toggleCategoryFilter,
  type LibraryFilters,
} from './libraryFilters';
import type { LibraryRecipe } from '../sync/offlineRecipes';

function recipe(overrides: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id: 'r1',
    title: 'Untitled',
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryIds: [],
    tags: [],
    plannedCount: 0,
    ...overrides,
  };
}

describe('activeFilterCount', () => {
  it('is zero for no filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('counts selected categories', () => {
    expect(activeFilterCount({ categoryIds: ['c1', 'c2'] })).toBe(2);
  });
});

describe('filterRecipes', () => {
  const chicken = recipe({ id: 'chicken', categoryIds: ['cat-chicken'] });
  const beef = recipe({ id: 'beef', categoryIds: ['cat-beef'] });
  const dessert = recipe({ id: 'dessert', categoryIds: ['cat-dessert'] });
  const all = [chicken, beef, dessert];

  it('returns everything unfiltered when no filters are active', () => {
    expect(filterRecipes(all, EMPTY_FILTERS)).toEqual(all);
  });

  it('ORs multiple selections within the category facet', () => {
    const filters: LibraryFilters = { categoryIds: ['cat-chicken', 'cat-beef'] };
    expect(filterRecipes(all, filters)).toEqual([chicken, beef]);
  });

  it('excludes recipes not matching any selected category', () => {
    const filters: LibraryFilters = { categoryIds: ['cat-chicken'] };
    expect(filterRecipes(all, filters)).toEqual([chicken]);
  });
});

describe('toggleCategoryFilter', () => {
  it('adds a category id not yet selected', () => {
    expect(toggleCategoryFilter(EMPTY_FILTERS, 'c1').categoryIds).toEqual(['c1']);
  });

  it('removes a category id already selected', () => {
    const filters: LibraryFilters = { categoryIds: ['c1', 'c2'] };
    expect(toggleCategoryFilter(filters, 'c1').categoryIds).toEqual(['c2']);
  });

  it('does not mutate the input', () => {
    const filters: LibraryFilters = { categoryIds: ['c1'] };
    toggleCategoryFilter(filters, 'c2');
    expect(filters.categoryIds).toEqual(['c1']);
  });
});
