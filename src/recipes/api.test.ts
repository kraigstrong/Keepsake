import {
  deleteDraft,
  fetchCategories,
  fetchDraft,
  fetchRecipe,
  fetchRecipeVersions,
  fetchRecipes,
  restoreRecipeVersion,
  saveDraft,
  saveRecipe,
} from './api';
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
  it('returns id/title/servingsCount summaries', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        is: () => ({
          is: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  { id: 'r1', title: 'Chili', servings_count: 6 },
                  { id: 'r2', title: 'Tacos', servings_count: null },
                ],
                error: null,
              }),
          }),
        }),
      }),
    });

    await expect(fetchRecipes()).resolves.toEqual([
      { id: 'r1', title: 'Chili', servingsCount: 6 },
      { id: 'r2', title: 'Tacos', servingsCount: null },
    ]);
    expect(mockedFrom).toHaveBeenCalledWith('recipes');
  });

  it('excludes archived and deleted recipes (Phase 16, ADR-0025)', async () => {
    const order = jest.fn(() => Promise.resolve({ data: [], error: null }));
    const secondIs = jest.fn(() => ({ order }));
    const firstIs = jest.fn(() => ({ is: secondIs }));
    mockedFrom.mockReturnValue({ select: () => ({ is: firstIs }) });

    await fetchRecipes();

    expect(firstIs).toHaveBeenCalledWith('archived_at', null);
    expect(secondIs).toHaveBeenCalledWith('deleted_at', null);
  });

  it('throws on a Supabase error', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        is: () => ({
          is: () => ({
            order: () => Promise.resolve({ data: null, error: new Error('boom') }),
          }),
        }),
      }),
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
                version: 3,
                title: 'Herb Roast Chicken',
                hero_image_path: null,
                original_photo_path: null,
                active_time_minutes: 20,
                total_time_minutes: 70,
                yield_text: 'Serves 4',
                servings_count: 4,
                permanent_notes: null,
                source_url: null,
                source_attribution: null,
                tags: ['weeknight'],
                recipe_ingredient_sections: [
                  {
                    title: null,
                    sort_order: 0,
                    recipe_ingredients: [
                      {
                        line_text: 'second',
                        quantity_min: null,
                        quantity_max: null,
                        unit: null,
                        ingredient_text: null,
                        sort_order: 1,
                      },
                      {
                        line_text: 'first',
                        quantity_min: 1,
                        quantity_max: 1,
                        unit: null,
                        ingredient_text: 'first',
                        sort_order: 0,
                      },
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
      version: 3,
      title: 'Herb Roast Chicken',
      heroImagePath: null,
      originalPhotoPath: null,
      activeTimeMinutes: 20,
      totalTimeMinutes: 70,
      yieldText: 'Serves 4',
      servingsCount: 4,
      permanentNotes: null,
      sourceUrl: null,
      sourceAttribution: null,
      tags: ['weeknight'],
      categoryIds: ['cat-1'],
      ingredientSections: [
        {
          title: null,
          lines: [
            {
              lineText: 'first',
              quantityMin: 1,
              quantityMax: 1,
              unit: null,
              ingredientText: 'first',
            },
            {
              lineText: 'second',
              quantityMin: null,
              quantityMax: null,
              unit: null,
              ingredientText: null,
            },
          ],
        },
      ],
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
        baseVersion: null,
        title: 'Herb Roast Chicken',
        heroImagePath: null,
        activeTimeMinutes: null,
        totalTimeMinutes: null,
        yieldText: null,
        servingsCount: null,
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

  it('sends baseVersion when editing', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    mockedRpc.mockReturnValue({ single });

    await saveRecipe({
      id: 'r1',
      baseVersion: 2,
      title: 'Herb Roast Chicken',
      tags: [],
      categoryIds: [],
      ingredientSections: [],
      instructionSections: [],
    });

    expect(mockedRpc).toHaveBeenCalledWith(
      'save_recipe',
      expect.objectContaining({ payload: expect.objectContaining({ id: 'r1', baseVersion: 2 }) }),
    );
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

describe('fetchRecipeVersions', () => {
  it('returns versions newest-first', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                { id: 'v2', version_number: 2, created_at: '2026-08-02T00:00:00Z' },
                { id: 'v1', version_number: 1, created_at: '2026-08-01T00:00:00Z' },
              ],
              error: null,
            }),
        }),
      }),
    });

    await expect(fetchRecipeVersions('r1')).resolves.toEqual([
      { id: 'v2', versionNumber: 2, createdAt: '2026-08-02T00:00:00Z' },
      { id: 'v1', versionNumber: 1, createdAt: '2026-08-01T00:00:00Z' },
    ]);
    expect(mockedFrom).toHaveBeenCalledWith('recipe_versions');
  });
});

describe('restoreRecipeVersion', () => {
  it('calls the restore_recipe_version RPC', async () => {
    const single = jest.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    mockedRpc.mockReturnValue({ single });

    await expect(restoreRecipeVersion('v1')).resolves.toEqual({ id: 'r1' });
    expect(mockedRpc).toHaveBeenCalledWith('restore_recipe_version', { target_version_id: 'v1' });
  });
});

describe('drafts', () => {
  it('fetchDraft queries by recipe id when editing', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { draft_payload: { title: 'Draft' } }, error: null });
    const eq = jest.fn(() => ({ maybeSingle }));
    mockedFrom.mockReturnValue({ select: () => ({ eq, is: jest.fn() }) });

    await expect(fetchDraft('r1')).resolves.toEqual({ title: 'Draft' });
    expect(eq).toHaveBeenCalledWith('recipe_id', 'r1');
  });

  it('fetchDraft queries for a null recipe id when creating', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const is = jest.fn(() => ({ maybeSingle }));
    mockedFrom.mockReturnValue({ select: () => ({ eq: jest.fn(), is }) });

    await expect(fetchDraft(null)).resolves.toBeNull();
    expect(is).toHaveBeenCalledWith('recipe_id', null);
  });

  it('saveDraft calls upsert_draft', async () => {
    mockedRpc.mockResolvedValue({ error: null });

    await saveDraft('r1', {
      title: 'Draft',
      tags: [],
      categoryIds: [],
      ingredientSections: [],
      instructionSections: [],
    });

    expect(mockedRpc).toHaveBeenCalledWith('upsert_draft', {
      recipe_id_param: 'r1',
      draft_payload_param: {
        title: 'Draft',
        tags: [],
        categoryIds: [],
        ingredientSections: [],
        instructionSections: [],
      },
    });
  });

  it('deleteDraft calls delete_draft', async () => {
    mockedRpc.mockResolvedValue({ error: null });

    await deleteDraft(null);

    expect(mockedRpc).toHaveBeenCalledWith('delete_draft', { recipe_id_param: null });
  });
});
