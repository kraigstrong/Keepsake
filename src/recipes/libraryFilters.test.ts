import {
  activeFilterCount,
  EMPTY_FILTERS,
  filterRecipes,
  toggleCategoryFilter,
  toggleTagFilter,
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
    ...overrides,
  };
}

describe('activeFilterCount', () => {
  it('is zero for no filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('sums categories and tags', () => {
    expect(activeFilterCount({ categoryIds: ['c1', 'c2'], tags: ['weeknight'] })).toBe(3);
  });
});

describe('filterRecipes', () => {
  const chicken = recipe({ id: 'chicken', categoryIds: ['cat-chicken'], tags: ['weeknight'] });
  const beef = recipe({ id: 'beef', categoryIds: ['cat-beef'], tags: ['freezer'] });
  const dessert = recipe({ id: 'dessert', categoryIds: ['cat-dessert'], tags: ['weeknight'] });
  const all = [chicken, beef, dessert];

  it('returns everything unfiltered when no filters are active', () => {
    expect(filterRecipes(all, EMPTY_FILTERS)).toEqual(all);
  });

  it('ORs multiple selections within the same facet (category)', () => {
    const filters: LibraryFilters = { categoryIds: ['cat-chicken', 'cat-beef'], tags: [] };
    expect(filterRecipes(all, filters)).toEqual([chicken, beef]);
  });

  it('ORs multiple selections within the same facet (tags)', () => {
    const filters: LibraryFilters = { categoryIds: [], tags: ['weeknight', 'freezer'] };
    expect(filterRecipes(all, filters)).toEqual([chicken, beef, dessert]);
  });

  it('ANDs across facets — category and tag filters both narrow the result', () => {
    const filters: LibraryFilters = { categoryIds: ['cat-chicken'], tags: ['freezer'] };
    expect(filterRecipes(all, filters)).toEqual([]);
  });

  it('a recipe matching the category but not the tag facet is excluded', () => {
    const filters: LibraryFilters = { categoryIds: ['cat-chicken'], tags: ['freezer'] };
    expect(filterRecipes(all, filters)).not.toContain(chicken);
  });
});

describe('toggleCategoryFilter / toggleTagFilter', () => {
  it('adds a category id not yet selected', () => {
    expect(toggleCategoryFilter(EMPTY_FILTERS, 'c1').categoryIds).toEqual(['c1']);
  });

  it('removes a category id already selected', () => {
    const filters: LibraryFilters = { categoryIds: ['c1', 'c2'], tags: [] };
    expect(toggleCategoryFilter(filters, 'c1').categoryIds).toEqual(['c2']);
  });

  it('does not mutate the input', () => {
    const filters: LibraryFilters = { categoryIds: ['c1'], tags: [] };
    toggleCategoryFilter(filters, 'c2');
    expect(filters.categoryIds).toEqual(['c1']);
  });

  it('tags toggle independently of categories', () => {
    const filters: LibraryFilters = { categoryIds: ['c1'], tags: [] };
    const next = toggleTagFilter(filters, 'weeknight');
    expect(next).toEqual({ categoryIds: ['c1'], tags: ['weeknight'] });
  });
});
