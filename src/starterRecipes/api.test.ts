import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';
import { syncHousehold } from '../sync/syncEngine';
import { seedStarterRecipes } from './api';

jest.mock('../supabase/instance', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));
jest.mock('../sync/syncEngine', () => ({ syncHousehold: jest.fn(() => Promise.resolve()) }));

const mockedRpc = supabase.rpc as jest.Mock;
const mockedTrack = trackEvent as jest.Mock;
const mockedSync = syncHousehold as jest.Mock;

function rpcReturns(result: { data: unknown; error: unknown }) {
  mockedRpc.mockReturnValue({ single: () => Promise.resolve(result) });
}

type SentRecipe = {
  title: string;
  yieldText: string;
  servingsCount: number | null;
  sourceAttribution: string;
  categories: { group: string; value: string }[];
  ingredientSections: {
    title: string | null;
    lines: {
      lineText: string;
      quantityMin: number | null;
      unit: string | null;
      ingredientText: string | null;
    }[];
  }[];
};

function sentRecipes(): SentRecipe[] {
  return mockedRpc.mock.calls[0][1].payload.recipes as SentRecipe[];
}

afterEach(() => jest.clearAllMocks());

describe('seedStarterRecipes', () => {
  it('sends all ten recipes to the RPC', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });

    await expect(seedStarterRecipes('household-1')).resolves.toEqual({
      seeded: true,
      recipeCount: 10,
    });

    expect(mockedRpc).toHaveBeenCalledWith('seed_starter_recipes', expect.anything());
    expect(sentRecipes()).toHaveLength(10);
  });

  it('parses ingredient lines before sending them', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    // A regression in the wiring shows up here even when the parser
    // itself is fine — the line arrives structured, not as a string.
    const bolognese = sentRecipes().find((r) => r.title === 'Weeknight Bolognese');
    const beef = bolognese?.ingredientSections[0]?.lines.find(
      (line) => line.lineText === '1 1/2 lb ground beef',
    );
    expect(beef).toEqual({
      lineText: '1 1/2 lb ground beef',
      quantityMin: 1.5,
      quantityMax: 1.5,
      unit: 'lb',
      ingredientText: 'ground beef',
    });
  });

  it('derives servingsCount from the yield, leaving the cookies null', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    const recipes = sentRecipes();
    expect(recipes.find((r) => r.title === 'Weeknight Bolognese')?.servingsCount).toBe(6);
    expect(
      recipes.find((r) => r.title === 'Brown Butter Chocolate Chip Cookies')?.servingsCount,
    ).toBeNull();
  });

  it('sends categories unresolved, for the RPC to look up', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    // Ids are environment-specific, so the client must never send them.
    for (const recipe of sentRecipes()) {
      for (const category of recipe.categories) {
        expect(Object.keys(category).sort()).toEqual(['group', 'value']);
      }
      expect(recipe.sourceAttribution).toBe('Keepsake starter recipe');
      expect(recipe).not.toHaveProperty('sourceUrl');
    }
  });

  it('syncs the local mirror after a successful seed', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    expect(mockedSync).toHaveBeenCalledWith('household-1');
  });

  it('syncs even when the household had already seeded', async () => {
    // seeded: false still means the recipes exist server-side — a device
    // that never synced them still needs to pull them down.
    rpcReturns({ data: { seeded: false, recipe_count: 0 }, error: null });

    await expect(seedStarterRecipes('household-1')).resolves.toEqual({
      seeded: false,
      recipeCount: 0,
    });
    expect(mockedSync).toHaveBeenCalledWith('household-1');
  });

  it('fires starter_recipes_added exactly once on a fresh seed', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    expect(mockedTrack).toHaveBeenCalledTimes(1);
    expect(mockedTrack).toHaveBeenCalledWith('starter_recipes_added', { count: 10 });
  });

  it('fires no event when the seed was a no-op', async () => {
    rpcReturns({ data: { seeded: false, recipe_count: 0 }, error: null });
    await seedStarterRecipes('household-1');

    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('never fires recipe_saved', async () => {
    rpcReturns({ data: { seeded: true, recipe_count: 10 }, error: null });
    await seedStarterRecipes('household-1');

    // Ten fake activation events is the whole reason this calls the RPC
    // directly instead of looping saveRecipe().
    expect(mockedTrack).not.toHaveBeenCalledWith('recipe_saved', expect.anything());
  });

  it('propagates an RPC error without syncing or reporting', async () => {
    rpcReturns({ data: null, error: { message: 'boom' } });

    await expect(seedStarterRecipes('household-1')).rejects.toEqual({ message: 'boom' });
    expect(mockedSync).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});
