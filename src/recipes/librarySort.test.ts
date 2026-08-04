import { sortRecipes } from './librarySort';
import type { LibraryRecipe } from '../sync/offlineRecipes';

const NOW = new Date('2026-08-15T00:00:00.000Z');

function recipe(overrides: Partial<LibraryRecipe> = {}): LibraryRecipe {
  return {
    id: overrides.id ?? 'r1',
    title: 'Untitled',
    createdAt: '2026-01-01T00:00:00.000Z',
    categoryIds: [],
    tags: [],
    ...overrides,
  };
}

describe('sortRecipes: alphabetical', () => {
  it('orders by title, case-sensibly', () => {
    const recipes = [recipe({ id: 'r1', title: 'Tacos' }), recipe({ id: 'r2', title: 'Chili' })];
    expect(sortRecipes(recipes, 'alphabetical', NOW).map((r) => r.id)).toEqual(['r2', 'r1']);
  });
});

describe('sortRecipes: recentlyAdded', () => {
  it('orders newest createdAt first, regardless of the 2-week window', () => {
    const recipes = [
      recipe({ id: 'old', createdAt: '2020-01-01T00:00:00.000Z' }),
      recipe({ id: 'new', createdAt: '2026-08-14T00:00:00.000Z' }),
    ];
    expect(sortRecipes(recipes, 'recentlyAdded', NOW).map((r) => r.id)).toEqual(['new', 'old']);
  });
});

describe('sortRecipes: smart', () => {
  it('puts recipes created within the last 2 weeks ahead of everything else', () => {
    const recipes = [
      recipe({ id: 'old', title: 'Aardvark Stew', createdAt: '2020-01-01T00:00:00.000Z' }),
      recipe({ id: 'new', title: 'Zucchini Bread', createdAt: '2026-08-10T00:00:00.000Z' }),
    ];
    // "new" is alphabetically after "old" but was added inside the last
    // 2 weeks, so it must still lead.
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('orders the recently-added tier newest-first', () => {
    const recipes = [
      recipe({ id: 'a', createdAt: '2026-08-08T00:00:00.000Z' }),
      recipe({ id: 'b', createdAt: '2026-08-12T00:00:00.000Z' }),
    ];
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('orders the remaining tier alphabetically', () => {
    const recipes = [
      recipe({ id: 'r1', title: 'Tacos', createdAt: '2020-01-01T00:00:00.000Z' }),
      recipe({ id: 'r2', title: 'Chili', createdAt: '2020-01-01T00:00:00.000Z' }),
    ];
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('treats a recipe created exactly 2 weeks ago as still within the window', () => {
    const recipes = [recipe({ id: 'edge', createdAt: '2026-08-01T00:00:00.000Z' })];
    // Should not throw or misclassify at the boundary — inclusive.
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['edge']);
  });

  it('does not mutate the input array', () => {
    const recipes = [recipe({ id: 'r1', title: 'B' }), recipe({ id: 'r2', title: 'A' })];
    const original = [...recipes];
    sortRecipes(recipes, 'smart', NOW);
    expect(recipes).toEqual(original);
  });
});
