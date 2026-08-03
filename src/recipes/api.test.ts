import { fetchCategories, fetchRecipe, fetchRecipes, saveRecipe } from './api';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;
const mockedRpc = supabase.rpc as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('fetchRecipes', () => {
  it('returns id/title summaries', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: [
              { id: 'r1', title: 'Chili' },
              { id: 'r2', title: 'Tacos' },
            ],
            error: null,
          }),
      }),
    });

    await expect(fetchRecipes()).resolves.toEqual([
      { id: 'r1', title: 'Chili' },
      { id: 'r2', title: 'Tacos' },
    ]);
    expect(mockedFrom).toHaveBeenCalledWith('recipes');
  });

  it('throws on a Supabase error', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: null, error: new Error('boom') }) }),
    });

    await expect(fetchRecipes()).rejects.toThrow('boom');
  });
});

describe('fetchCategories', () => {
  it('maps group_name/value to camelCase', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: [{ id: 'c1', group_name: 'protein', value: 'Chicken' }],
            error: null,
          }),
      }),
    });

    await expect(fetchCategories()).resolves.toEqual([
      { id: 'c1', groupName: 'protein', value: 'Chicken' },
    ]);
  });
});

describe('fetchRecipe', () => {
  it('maps the nested embed and sorts sections/lines by sort_order', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: 'r1',
                title: 'Herb Roast Chicken',
                hero_image_path: null,
                active_time_minutes: 20,
                total_time_minutes: 70,
                yield_text: 'Serves 4',
                permanent_notes: null,
                source_url: null,
                source_attribution: null,
                tags: ['weeknight'],
                recipe_ingredient_sections: [
                  {
                    title: null,
                    sort_order: 0,
                    recipe_ingredients: [
                      { line_text: 'second', sort_order: 1 },
                      { line_text: 'first', sort_order: 0 },
                    ],
                  },
                ],
                recipe_instruction_sections: [
                  {
                    title: null,
                    sort_order: 0,
                    recipe_instructions: [{ line_text: 'Roast.', sort_order: 0 }],
                  },
                ],
                recipe_categories: [{ category_id: 'cat-1' }],
              },
              error: null,
            }),
        }),
      }),
    });

    await expect(fetchRecipe('r1')).resolves.toEqual({
      id: 'r1',
      title: 'Herb Roast Chicken',
      heroImagePath: null,
      activeTimeMinutes: 20,
      totalTimeMinutes: 70,
      yieldText: 'Serves 4',
      permanentNotes: null,
      sourceUrl: null,
      sourceAttribution: null,
      tags: ['weeknight'],
      categoryIds: ['cat-1'],
      ingredientSections: [{ title: null, lines: ['first', 'second'] }],
      instructionSections: [{ title: null, lines: ['Roast.'] }],
    });
  });
});

describe('saveRecipe', () => {
  it('calls the save_recipe RPC with defaults for omitted optional fields', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    mockedRpc.mockReturnValue({ single });

    await expect(
      saveRecipe({
        title: 'Herb Roast Chicken',
        tags: [],
        categoryIds: [],
        ingredientSections: [],
        instructionSections: [],
      }),
    ).resolves.toEqual({ id: 'r1' });

    expect(mockedRpc).toHaveBeenCalledWith('save_recipe', {
      payload: {
        id: null,
        title: 'Herb Roast Chicken',
        heroImagePath: null,
        activeTimeMinutes: null,
        totalTimeMinutes: null,
        yieldText: null,
        permanentNotes: null,
        sourceUrl: null,
        sourceAttribution: null,
        tags: [],
        categoryIds: [],
        ingredientSections: [],
        instructionSections: [],
      },
    });
  });

  it('throws on a Supabase error (e.g. cross-household edit)', async () => {
    mockedRpc.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: new Error('recipe not found') }),
    });

    await expect(
      saveRecipe({
        id: 'r1',
        title: 'Hijacked',
        tags: [],
        categoryIds: [],
        ingredientSections: [],
        instructionSections: [],
      }),
    ).rejects.toThrow('recipe not found');
  });
});
