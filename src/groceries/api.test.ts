import { fetchGroceryReview, setGroceryItemSelection } from './api';
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

const PLANNING_ENTRIES_ROW = {
  recipe_id: 'recipe-1',
  servings: 4,
  recipe: {
    servings_count: 4,
    recipe_ingredient_sections: [
      {
        recipe_ingredients: [
          {
            line_text: '1 onion',
            quantity_min: 1,
            quantity_max: 1,
            unit: null,
            ingredient_text: 'onion',
          },
          {
            line_text: '1 tsp salt',
            quantity_min: 1,
            quantity_max: 1,
            unit: 'tsp',
            ingredient_text: 'salt',
          },
        ],
      },
    ],
  },
};

function mockFromForTables(tables: Record<string, { data: unknown; error: unknown }>) {
  mockedFrom.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => Promise.resolve(tables[table]),
    }),
  }));
}

describe('fetchGroceryReview', () => {
  it('computes the grocery list and applies defaults when no selections exist', async () => {
    mockFromForTables({
      planning_entries: { data: [PLANNING_ENTRIES_ROW], error: null },
      grocery_item_selections: { data: [], error: null },
    });

    const result = await fetchGroceryReview('plan-1');

    expect(result.planId).toBe('plan-1');
    expect(result.items).toHaveLength(2);

    const onion = result.items.find((item) => item.amounts.includes('1 onion'));
    const salt = result.items.find((item) => item.category === 'pantry');
    expect(onion?.included).toBe(true); // non-staple defaults to included
    expect(salt?.isStaple).toBe(true);
    expect(salt?.included).toBe(false); // staple defaults to excluded
  });

  it('overlays an explicit selection over the computed default', async () => {
    mockFromForTables({
      planning_entries: { data: [PLANNING_ENTRIES_ROW], error: null },
      grocery_item_selections: { data: [], error: null },
    });
    // First call establishes which hash "salt" resolved to.
    const first = await fetchGroceryReview('plan-1');
    const saltHash = first.items.find((item) => item.category === 'pantry')!.itemHash;

    mockFromForTables({
      planning_entries: { data: [PLANNING_ENTRIES_ROW], error: null },
      grocery_item_selections: {
        data: [{ item_hash: saltHash, included: true }],
        error: null,
      },
    });
    const second = await fetchGroceryReview('plan-1');
    const salt = second.items.find((item) => item.itemHash === saltHash);
    expect(salt?.included).toBe(true);
  });

  it('throws when fetching planning entries fails', async () => {
    mockFromForTables({
      planning_entries: { data: null, error: new Error('boom') },
      grocery_item_selections: { data: [], error: null },
    });
    await expect(fetchGroceryReview('plan-1')).rejects.toThrow('boom');
  });

  it('throws when fetching selections fails', async () => {
    mockFromForTables({
      planning_entries: { data: [PLANNING_ENTRIES_ROW], error: null },
      grocery_item_selections: { data: null, error: new Error('boom') },
    });
    await expect(fetchGroceryReview('plan-1')).rejects.toThrow('boom');
  });
});

describe('setGroceryItemSelection', () => {
  it('calls set_grocery_item_selection with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await setGroceryItemSelection('plan-1', 'abc123', true);
    expect(mockedRpc).toHaveBeenCalledWith('set_grocery_item_selection', {
      plan_id: 'plan-1',
      item_hash: 'abc123',
      included: true,
    });
  });

  it('surfaces a Supabase error as a thrown Error', async () => {
    mockedRpc.mockResolvedValue({ error: new Error('nope') });
    await expect(setGroceryItemSelection('plan-1', 'abc123', true)).rejects.toThrow('nope');
  });
});
