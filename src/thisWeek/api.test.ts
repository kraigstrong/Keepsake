import {
  addRecipesToThisWeek,
  addRecipeToThisWeek,
  confirmThisWeek,
  fetchCurrentWeeklyPlan,
  removeConfirmedEntryFromThisWeek,
  removeFromThisWeek,
  reopenThisWeek,
  reorderThisWeek,
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

describe('fetchCurrentWeeklyPlan', () => {
  it('gets-or-creates the current plan and maps its entries', async () => {
    const single = () =>
      Promise.resolve({ data: { id: 'plan-1', status: 'planning' }, error: null });
    mockedRpc.mockReturnValue({ single });
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: 'entry-1',
                  recipe_id: 'recipe-1',
                  servings: 4,
                  position: 0,
                  recipe: { title: 'Herb Roast Chicken', hero_image_path: 'households/1/hero.jpg' },
                },
              ],
              error: null,
            }),
        }),
      }),
    });

    await expect(fetchCurrentWeeklyPlan()).resolves.toEqual({
      id: 'plan-1',
      status: 'planning',
      entries: [
        {
          id: 'entry-1',
          recipeId: 'recipe-1',
          title: 'Herb Roast Chicken',
          heroImagePath: 'households/1/hero.jpg',
          servings: 4,
          position: 0,
        },
      ],
    });
    expect(mockedRpc).toHaveBeenCalledWith(
      'get_or_create_current_weekly_plan',
      expect.objectContaining({ week_key_param: expect.stringMatching(/^\d{4}-W\d{2}$/) }),
    );
    expect(mockedFrom).toHaveBeenCalledWith('planning_entries');
  });

  it('throws when the plan RPC fails', async () => {
    mockedRpc.mockReturnValue({
      single: () => Promise.resolve({ data: null, error: new Error('boom') }),
    });

    await expect(fetchCurrentWeeklyPlan()).rejects.toThrow('boom');
  });

  it('throws when fetching entries fails', async () => {
    mockedRpc.mockReturnValue({
      single: () => Promise.resolve({ data: { id: 'plan-1', status: 'planning' }, error: null }),
    });
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: null, error: new Error('boom') }) }),
      }),
    });

    await expect(fetchCurrentWeeklyPlan()).rejects.toThrow('boom');
  });
});

describe('mutations', () => {
  it('addRecipeToThisWeek calls add_to_weekly_plan with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await addRecipeToThisWeek('plan-1', 'recipe-1', 4);
    expect(mockedRpc).toHaveBeenCalledWith('add_to_weekly_plan', {
      plan_id: 'plan-1',
      recipe_id: 'recipe-1',
      servings: 4,
    });
  });

  it('addRecipesToThisWeek calls add_recipes_to_weekly_plan with parallel arrays', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await addRecipesToThisWeek('plan-1', [
      { recipeId: 'r1', servings: 4 },
      { recipeId: 'r2', servings: 2 },
    ]);
    expect(mockedRpc).toHaveBeenCalledWith('add_recipes_to_weekly_plan', {
      plan_id: 'plan-1',
      recipe_ids: ['r1', 'r2'],
      servings_list: [4, 2],
    });
  });

  it('reorderThisWeek calls reorder_planning_entries with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await reorderThisWeek('plan-1', ['a', 'b']);
    expect(mockedRpc).toHaveBeenCalledWith('reorder_planning_entries', {
      plan_id: 'plan-1',
      ordered_entry_ids: ['a', 'b'],
    });
  });

  it('removeFromThisWeek calls remove_planning_entry with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await removeFromThisWeek('entry-1');
    expect(mockedRpc).toHaveBeenCalledWith('remove_planning_entry', { entry_id: 'entry-1' });
  });

  it('removeConfirmedEntryFromThisWeek calls remove_confirmed_planning_entry with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await removeConfirmedEntryFromThisWeek('entry-1');
    expect(mockedRpc).toHaveBeenCalledWith('remove_confirmed_planning_entry', {
      entry_id: 'entry-1',
    });
  });

  it('confirmThisWeek calls confirm_weekly_plan with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await confirmThisWeek('plan-1');
    expect(mockedRpc).toHaveBeenCalledWith('confirm_weekly_plan', { plan_id: 'plan-1' });
  });

  it('reopenThisWeek calls reopen_weekly_plan with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });
    await reopenThisWeek('plan-1');
    expect(mockedRpc).toHaveBeenCalledWith('reopen_weekly_plan', { plan_id: 'plan-1' });
  });

  it('surfaces a Supabase error as a thrown Error', async () => {
    mockedRpc.mockResolvedValue({ error: new Error('nope') });
    await expect(confirmThisWeek('plan-1')).rejects.toThrow('nope');
  });
});
