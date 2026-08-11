import { getCookingHistory, recordCookingEvent } from './api';
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

describe('getCookingHistory', () => {
  it('selects newest-first and maps rows to CookingEvent', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                {
                  id: 'event-1',
                  recipe_id: 'recipe-1',
                  cooked_at: '2026-08-10T18:00:00.000Z',
                  note: 'Needed another tsp salt.',
                },
              ],
              error: null,
            }),
        }),
      }),
    });

    await expect(getCookingHistory('recipe-1')).resolves.toEqual([
      {
        id: 'event-1',
        recipeId: 'recipe-1',
        cookedAt: '2026-08-10T18:00:00.000Z',
        note: 'Needed another tsp salt.',
      },
    ]);
    expect(mockedFrom).toHaveBeenCalledWith('cooking_events');
  });

  it('returns an empty array for a recipe with no cooking history', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: null, error: null }) }),
      }),
    });

    await expect(getCookingHistory('recipe-1')).resolves.toEqual([]);
  });

  it('throws when the select fails', async () => {
    mockedFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: null, error: new Error('boom') }) }),
      }),
    });

    await expect(getCookingHistory('recipe-1')).rejects.toThrow('boom');
  });
});

describe('recordCookingEvent', () => {
  it('calls record_cooking_event with the right args', async () => {
    mockedRpc.mockResolvedValue({ error: null });

    await recordCookingEvent({
      recipeId: 'recipe-1',
      cookedAt: '2026-08-10T18:00:00.000Z',
      note: 'Kids loved this.',
      clientEventId: 'event-1',
    });

    expect(mockedRpc).toHaveBeenCalledWith('record_cooking_event', {
      recipe_id: 'recipe-1',
      cooked_at: '2026-08-10T18:00:00.000Z',
      note: 'Kids loved this.',
      client_event_id: 'event-1',
    });
  });

  it('surfaces a Supabase error as a thrown Error', async () => {
    mockedRpc.mockResolvedValue({ error: new Error('nope') });
    await expect(
      recordCookingEvent({
        recipeId: 'recipe-1',
        cookedAt: '2026-08-10T18:00:00.000Z',
        note: null,
        clientEventId: 'event-1',
      }),
    ).rejects.toThrow('nope');
  });
});
