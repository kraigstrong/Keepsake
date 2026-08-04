import { fetchAllCategories, fetchChangedRecipes, fetchDeletedRecipes } from './remote';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: { from: jest.fn() },
}));

const mockedFrom = supabase.from as jest.Mock;

afterEach(() => jest.clearAllMocks());

interface FakeQueryBuilder {
  or: jest.Mock<FakeQueryBuilder, any[]>;
  order: jest.Mock<FakeQueryBuilder, any[]>;
  limit: jest.Mock<Promise<{ data: unknown; error: unknown }>, any[]>;
}

function createQueryBuilder(result: { data: unknown; error: unknown }): FakeQueryBuilder {
  const builder: FakeQueryBuilder = {
    or: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe('fetchChangedRecipes', () => {
  const fetchedRow = {
    id: 'r1',
    household_id: 'h1',
    version: 2,
    title: 'Chili',
    hero_image_path: null,
    active_time_minutes: 20,
    total_time_minutes: 60,
    yield_text: 'Serves 4',
    permanent_notes: null,
    source_url: null,
    source_attribution: null,
    tags: ['spicy'],
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
    recipe_ingredient_sections: [{ title: null, sort_order: 0, recipe_ingredients: [] }],
    recipe_instruction_sections: [{ title: null, sort_order: 0, recipe_instructions: [] }],
    recipe_categories: [{ category_id: 'c1' }],
  };

  it('fetches with no filter when the cursor is empty (initial sync)', async () => {
    const builder = createQueryBuilder({ data: [fetchedRow], error: null });
    mockedFrom.mockReturnValue({ select: () => builder });

    const rows = await fetchChangedRecipes(null, null);

    expect(builder.or).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        id: 'r1',
        householdId: 'h1',
        version: 2,
        title: 'Chili',
        heroImagePath: null,
        activeTimeMinutes: 20,
        totalTimeMinutes: 60,
        yieldText: 'Serves 4',
        permanentNotes: null,
        sourceUrl: null,
        sourceAttribution: null,
        tags: ['spicy'],
        categoryIds: ['c1'],
        ingredientSections: [{ title: null, lines: [] }],
        instructionSections: [{ title: null, lines: [] }],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z',
      },
    ]);
  });

  it('applies an (updated_at, id) tuple filter when a cursor exists', async () => {
    const builder = createQueryBuilder({ data: [], error: null });
    mockedFrom.mockReturnValue({ select: () => builder });

    await fetchChangedRecipes('2026-08-04T00:00:00.000Z', 'r0');

    expect(builder.or).toHaveBeenCalledWith(
      'updated_at.gt.2026-08-04T00:00:00.000Z,and(updated_at.eq.2026-08-04T00:00:00.000Z,id.gt.r0)',
    );
  });

  it('throws on a Supabase error', async () => {
    const builder = createQueryBuilder({ data: null, error: new Error('boom') });
    mockedFrom.mockReturnValue({ select: () => builder });

    await expect(fetchChangedRecipes(null, null)).rejects.toThrow('boom');
  });
});

describe('fetchDeletedRecipes', () => {
  it('maps rows to camelCase and applies the (deleted_at, id) cursor filter', async () => {
    const builder = createQueryBuilder({
      data: [{ id: 'r1', household_id: 'h1', deleted_at: '2026-08-05T00:00:00.000Z' }],
      error: null,
    });
    mockedFrom.mockReturnValue({ select: () => builder });

    const rows = await fetchDeletedRecipes('2026-08-04T00:00:00.000Z', 'r0');

    expect(builder.or).toHaveBeenCalledWith(
      'deleted_at.gt.2026-08-04T00:00:00.000Z,and(deleted_at.eq.2026-08-04T00:00:00.000Z,id.gt.r0)',
    );
    expect(rows).toEqual([{ id: 'r1', householdId: 'h1', deletedAt: '2026-08-05T00:00:00.000Z' }]);
  });
});

describe('fetchAllCategories', () => {
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

    await expect(fetchAllCategories()).resolves.toEqual([
      { id: 'c1', groupName: 'protein', value: 'Chicken' },
    ]);
  });
});
