import { getDatabase } from '../db/database';
import { trackEvent } from '../observability';
import { searchRecipes } from './search';

jest.mock('../db/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../observability', () => ({ trackEvent: jest.fn() }));

const mockedGetDatabase = getDatabase as jest.Mock;
const mockedTrackEvent = trackEvent as jest.Mock;
const HOUSEHOLD_ID = 'hh1';

function mockDb(getAllAsyncImpl: (sql: string) => unknown[]) {
  return {
    getAllAsync: jest.fn(async (sql: string) => getAllAsyncImpl(sql)),
  };
}

afterEach(() => jest.clearAllMocks());

describe('searchRecipes', () => {
  it('returns an empty array without touching the database for a blank query', async () => {
    await expect(searchRecipes('   ', HOUSEHOLD_ID)).resolves.toEqual([]);
    expect(mockedGetDatabase).not.toHaveBeenCalled();
  });

  it('returns title-tier matches and never the raw query text in telemetry', async () => {
    mockedGetDatabase.mockResolvedValue(
      mockDb((sql) =>
        sql.includes('bm25(recipe_fts)') && sql.includes('order by t.rank')
          ? [{ recipe_id: 'r1', title: 'Tomato Soup', rank: -1 }]
          : [],
      ),
    );

    await expect(searchRecipes('tomato', HOUSEHOLD_ID)).resolves.toEqual([
      { id: 'r1', title: 'Tomato Soup' },
    ]);

    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'search_performed',
      expect.objectContaining({ resultCount: 1, durationMs: expect.any(Number) }),
    );
    const props = mockedTrackEvent.mock.calls[0]![1];
    expect(JSON.stringify(props)).not.toContain('tomato');
  });

  it('falls back to the fuzzy trigram query when every tier is empty', async () => {
    mockedGetDatabase.mockResolvedValue(
      mockDb((sql) =>
        sql.includes('recipe_trigram')
          ? [{ recipe_id: 'r1', title: 'Tomato Soup', shared: 3 }]
          : [],
      ),
    );

    await expect(searchRecipes('tomatto', HOUSEHOLD_ID)).resolves.toEqual([
      { id: 'r1', title: 'Tomato Soup' },
    ]);
  });

  it('reports zero results without throwing when nothing matches at all', async () => {
    mockedGetDatabase.mockResolvedValue(mockDb(() => []));

    await expect(searchRecipes('nonexistent', HOUSEHOLD_ID)).resolves.toEqual([]);
    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'search_performed',
      expect.objectContaining({ resultCount: 0 }),
    );
  });
});
