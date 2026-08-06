import { flattenRecipeForSearch, type IndexableRecipe } from './indexRecipe';

function recipe(overrides: Partial<IndexableRecipe> = {}): IndexableRecipe {
  return {
    id: 'r1',
    title: 'Roasted Tomato Soup',
    permanentNotes: null,
    sourceUrl: null,
    sourceAttribution: null,
    tags: [],
    categoryIds: [],
    ingredientSections: [],
    ...overrides,
  };
}

describe('flattenRecipeForSearch', () => {
  it('flattens ingredient section titles and lines into one string', () => {
    const row = flattenRecipeForSearch(
      recipe({
        ingredientSections: [
          { title: 'Soup', lines: [{ lineText: '2 tomatoes' }, { lineText: '1 onion' }] },
          { title: null, lines: [{ lineText: 'salt' }] },
        ],
      }),
      new Map(),
    );
    expect(row.ingredients).toBe('Soup 2 tomatoes 1 onion salt');
  });

  it('resolves category ids to labels via the lookup map, dropping unknown ids', () => {
    const row = flattenRecipeForSearch(
      recipe({ categoryIds: ['cat-chicken', 'cat-unknown'] }),
      new Map([['cat-chicken', 'Chicken']]),
    );
    expect(row.categories).toBe('Chicken');
  });

  it('joins tags with spaces', () => {
    const row = flattenRecipeForSearch(
      recipe({ tags: ['weeknight', 'freezer-friendly'] }),
      new Map(),
    );
    expect(row.tags).toBe('weeknight freezer-friendly');
  });

  it('defaults nullable text fields to empty strings, not "null"', () => {
    const row = flattenRecipeForSearch(recipe(), new Map());
    expect(row.notes).toBe('');
    expect(row.sourceAttribution).toBe('');
    expect(row.sourceUrl).toBe('');
  });

  it('passes through title and recipe id unchanged', () => {
    const row = flattenRecipeForSearch(recipe({ id: 'r42', title: 'Chicken Tikka' }), new Map());
    expect(row.recipeId).toBe('r42');
    expect(row.title).toBe('Chicken Tikka');
  });
});
