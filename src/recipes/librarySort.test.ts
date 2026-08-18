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
    plannedCount: 0,
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

describe('sortRecipes: frequentlySelected', () => {
  it('orders the whole library by planned count descending, ties alphabetically', () => {
    const recipes = [
      recipe({ id: 'never', title: 'Never Planned', plannedCount: 0 }),
      recipe({ id: 'most', title: 'Most Planned', plannedCount: 5 }),
      recipe({ id: 'tie-a', title: 'B Tie', plannedCount: 2 }),
      recipe({ id: 'tie-b', title: 'A Tie', plannedCount: 2 }),
    ];
    expect(sortRecipes(recipes, 'frequentlySelected', NOW).map((r) => r.id)).toEqual([
      'most',
      'tie-b',
      'tie-a',
      'never',
    ]);
  });

  it('unlike Smart, does not put recently-added recipes ahead regardless of count', () => {
    const recipes = [
      recipe({
        id: 'new-unplanned',
        title: 'New',
        createdAt: '2026-08-14T00:00:00.000Z',
        plannedCount: 0,
      }),
      recipe({
        id: 'old-planned',
        title: 'Old',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 3,
      }),
    ];
    expect(sortRecipes(recipes, 'frequentlySelected', NOW).map((r) => r.id)).toEqual([
      'old-planned',
      'new-unplanned',
    ]);
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

  it('puts frequently-selected recipes (planned > 0) ahead of everything but recently-added', () => {
    const recipes = [
      recipe({
        id: 'never-planned',
        title: 'Aardvark Stew',
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
      recipe({
        id: 'planned',
        title: 'Zucchini Bread',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 3,
      }),
    ];
    // "planned" is alphabetically after "never-planned" and neither is
    // recently added, but a planned_count > 0 still outranks it.
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual([
      'planned',
      'never-planned',
    ]);
  });

  it('orders the frequently-selected tier by planned count descending, ties alphabetically', () => {
    const recipes = [
      recipe({
        id: 'a',
        title: 'B Recipe',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 2,
      }),
      recipe({
        id: 'b',
        title: 'A Recipe',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 5,
      }),
      recipe({
        id: 'c',
        title: 'A Tie',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 2,
      }),
    ];
    // b (5) leads; a and c tie at 2, broken alphabetically by title
    // ("A Tie" < "B Recipe"), so c comes before a.
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps a recently-added recipe in the recently-added tier even if it has also been planned', () => {
    const recipes = [
      recipe({
        id: 'new-and-planned',
        title: 'Zucchini Bread',
        createdAt: '2026-08-10T00:00:00.000Z',
        plannedCount: 10,
      }),
      recipe({
        id: 'old-unplanned',
        title: 'Aardvark Stew',
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
    ];
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual([
      'new-and-planned',
      'old-unplanned',
    ]);
  });

  it('excludes a recipe created exactly 2 weeks ago from Recently Added (LIB-01 is <2wk, exclusive)', () => {
    const recipes = [
      recipe({ id: 'edge', title: 'Edge', createdAt: '2026-08-01T00:00:00.000Z' }),
      recipe({
        id: 'planned',
        title: 'Planned',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 1,
      }),
    ];
    // Exactly 2 weeks old is not "<2wk" — falls to a later tier, so a
    // planned-but-older recipe now outranks it (same tiering smartSort
    // already does for anything else past the cutoff).
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['planned', 'edge']);
  });

  it('includes a recipe created one millisecond within the 2-week window', () => {
    const recipes = [
      recipe({ id: 'just-in', title: 'Just In', createdAt: '2026-08-01T00:00:00.001Z' }),
      recipe({
        id: 'planned',
        title: 'Planned',
        createdAt: '2020-01-01T00:00:00.000Z',
        plannedCount: 1,
      }),
    ];
    expect(sortRecipes(recipes, 'smart', NOW).map((r) => r.id)).toEqual(['just-in', 'planned']);
  });

  it('does not mutate the input array', () => {
    const recipes = [recipe({ id: 'r1', title: 'B' }), recipe({ id: 'r2', title: 'A' })];
    const original = [...recipes];
    sortRecipes(recipes, 'smart', NOW);
    expect(recipes).toEqual(original);
  });
});
