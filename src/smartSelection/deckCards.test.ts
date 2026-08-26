import { fetchDeckCardDetails } from './deckCards';
import { supabase } from '../supabase/instance';

jest.mock('../supabase/instance', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

const mockedFrom = supabase.from as jest.Mock;

afterEach(() => jest.clearAllMocks());

describe('fetchDeckCardDetails', () => {
  it('returns an empty map without querying for an empty input', async () => {
    const result = await fetchDeckCardDetails([]);

    expect(result).toEqual(new Map());
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('batches one .in() read and maps rows by recipe id', async () => {
    const inFn = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'recipe-1',
          title: 'Herb Roast Chicken',
          hero_image_path: 'path/1.jpg',
          total_time_minutes: 45,
        },
        {
          id: 'recipe-2',
          title: 'Sourdough Loaf',
          hero_image_path: null,
          total_time_minutes: null,
        },
      ],
      error: null,
    });
    const select = jest.fn().mockReturnValue({ in: inFn });
    mockedFrom.mockReturnValue({ select });

    const result = await fetchDeckCardDetails(['recipe-1', 'recipe-2']);

    expect(mockedFrom).toHaveBeenCalledWith('recipes');
    expect(select).toHaveBeenCalledWith('id, title, hero_image_path, total_time_minutes');
    expect(inFn).toHaveBeenCalledWith('id', ['recipe-1', 'recipe-2']);
    expect(result).toEqual(
      new Map([
        [
          'recipe-1',
          { title: 'Herb Roast Chicken', heroImagePath: 'path/1.jpg', totalTimeMinutes: 45 },
        ],
        ['recipe-2', { title: 'Sourdough Loaf', heroImagePath: null, totalTimeMinutes: null }],
      ]),
    );
  });

  it('throws on a query error', async () => {
    const inFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const select = jest.fn().mockReturnValue({ in: inFn });
    mockedFrom.mockReturnValue({ select });

    await expect(fetchDeckCardDetails(['recipe-1'])).rejects.toThrow('boom');
  });
});
