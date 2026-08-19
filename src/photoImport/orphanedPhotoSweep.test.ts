import { findOrphanedOriginalPhotos, sweepOrphanedOriginalPhotos } from './orphanedPhotoSweep';
import { logError } from '../observability';
import { supabase } from '../supabase/instance';

jest.mock('../observability', () => ({ logError: jest.fn() }));

jest.mock('../supabase/instance', () => ({
  supabase: { storage: { from: jest.fn() }, from: jest.fn() },
}));

const mockedStorageFrom = supabase.storage.from as jest.Mock;
const mockedFrom = supabase.from as jest.Mock;
const mockedLogError = logError as jest.Mock;

const NOW = new Date('2026-08-18T00:00:00Z');
const OLD = '2026-07-01T00:00:00Z'; // 48 days before NOW
const RECENT = '2026-08-10T00:00:00Z'; // 8 days before NOW

describe('findOrphanedOriginalPhotos', () => {
  it('excludes objects referenced by a recipe, even if old', () => {
    const result = findOrphanedOriginalPhotos(
      'household-1',
      [{ name: 'a.jpg', created_at: OLD }],
      new Set(['household-1/originals/a.jpg']),
      NOW,
    );

    expect(result).toEqual([]);
  });

  it('excludes unreferenced objects younger than the 30-day threshold', () => {
    const result = findOrphanedOriginalPhotos(
      'household-1',
      [{ name: 'a.jpg', created_at: RECENT }],
      new Set(),
      NOW,
    );

    expect(result).toEqual([]);
  });

  it("excludes objects with no created_at (can't establish age, so it can't establish orphanhood)", () => {
    const result = findOrphanedOriginalPhotos(
      'household-1',
      [{ name: 'a.jpg', created_at: null }],
      new Set(),
      NOW,
    );

    expect(result).toEqual([]);
  });

  it('returns unreferenced objects older than the 30-day threshold as full paths', () => {
    const result = findOrphanedOriginalPhotos(
      'household-1',
      [{ name: 'a.jpg', created_at: OLD }],
      new Set(),
      NOW,
    );

    expect(result).toEqual(['household-1/originals/a.jpg']);
  });

  it('only flags the orphaned subset of a mixed listing', () => {
    const result = findOrphanedOriginalPhotos(
      'household-1',
      [
        { name: 'orphan.jpg', created_at: OLD },
        { name: 'referenced.jpg', created_at: OLD },
        { name: 'too-new.jpg', created_at: RECENT },
      ],
      new Set(['household-1/originals/referenced.jpg']),
      NOW,
    );

    expect(result).toEqual(['household-1/originals/orphan.jpg']);
  });
});

// recipesQuery mocks the chained .from('recipes').select(...).not(...).order(...).range(...)
// call — `handler` receives each call's (offset, limitInclusiveEnd) range and returns that
// page's { data, error }.
function mockRecipesQuery(
  handler: (offset: number, to: number) => { data: unknown; error: unknown },
) {
  const range = jest.fn((from: number, to: number) => Promise.resolve(handler(from, to)));
  const order = jest.fn().mockReturnValue({ range });
  const not = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ not });
  mockedFrom.mockReturnValue({ select });
  return { select, not, order, range };
}

describe('sweepOrphanedOriginalPhotos', () => {
  afterEach(() => jest.clearAllMocks());

  it('does nothing when the originals/ listing is empty', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedStorageFrom.mockReturnValue({ list });

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedStorageFrom).toHaveBeenCalledWith('recipe-images');
    expect(list).toHaveBeenCalledWith('household-1/originals', {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('logs and stops without querying recipes when listing fails', async () => {
    const listError = new Error('storage unreachable');
    mockedStorageFrom.mockReturnValue({
      list: jest.fn().mockResolvedValue({ data: null, error: listError }),
    });

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedLogError).toHaveBeenCalledWith(listError, {
      context: 'sweepOrphanedOriginalPhotos.list',
    });
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('logs and stops without removing anything when the recipes query fails', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ name: 'a.jpg', created_at: OLD }],
      error: null,
    });
    const remove = jest.fn();
    mockedStorageFrom.mockReturnValue({ list, remove });
    const queryError = new Error('query failed');
    mockRecipesQuery(() => ({ data: null, error: queryError }));

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedLogError).toHaveBeenCalledWith(queryError, {
      context: 'sweepOrphanedOriginalPhotos.query',
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes only the orphaned objects, leaving referenced ones alone', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [
        { name: 'orphan.jpg', created_at: OLD },
        { name: 'referenced.jpg', created_at: OLD },
      ],
      error: null,
    });
    const remove = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ list, remove });
    mockRecipesQuery(() => ({
      data: [{ original_photo_path: 'household-1/originals/referenced.jpg' }],
      error: null,
    }));

    await sweepOrphanedOriginalPhotos('household-1');

    expect(remove).toHaveBeenCalledWith(['household-1/originals/orphan.jpg']);
  });

  it('never calls remove when nothing is orphaned', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ name: 'referenced.jpg', created_at: OLD }],
      error: null,
    });
    const remove = jest.fn();
    mockedStorageFrom.mockReturnValue({ list, remove });
    mockRecipesQuery(() => ({
      data: [{ original_photo_path: 'household-1/originals/referenced.jpg' }],
      error: null,
    }));

    await sweepOrphanedOriginalPhotos('household-1');

    expect(remove).not.toHaveBeenCalled();
  });

  it('logs a remove failure', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ name: 'orphan.jpg', created_at: OLD }],
      error: null,
    });
    const removeError = new Error('remove failed');
    const remove = jest.fn().mockResolvedValue({ error: removeError });
    mockedStorageFrom.mockReturnValue({ list, remove });
    mockRecipesQuery(() => ({ data: [], error: null }));

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedLogError).toHaveBeenCalledWith(removeError, {
      context: 'sweepOrphanedOriginalPhotos.remove',
    });
  });

  // Codex review, PR #76: a single unpaginated query silently truncates at
  // supabase/config.toml's api.max_rows (1000) instead of erroring — a
  // household with >1000 recipes carrying an original_photo_path could
  // have a genuinely-referenced path fall past the cap and read as
  // orphaned. These prove both the Storage listing and the recipes query
  // page through everything before any deletion decision is made.
  it('pages through more than one page of the originals/ listing before deciding anything', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      name: `page1-${i}.jpg`,
      created_at: RECENT,
    }));
    const secondPage = [{ name: 'orphan.jpg', created_at: OLD }];
    const list = jest
      .fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });
    const remove = jest.fn().mockResolvedValue({ error: null });
    mockedStorageFrom.mockReturnValue({ list, remove });
    mockRecipesQuery(() => ({ data: [], error: null }));

    await sweepOrphanedOriginalPhotos('household-1');

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, 'household-1/originals', {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    expect(list).toHaveBeenNthCalledWith(2, 'household-1/originals', {
      limit: 1000,
      offset: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });
    expect(remove).toHaveBeenCalledWith(['household-1/originals/orphan.jpg']);
  });

  it('pages through more than one page of referenced recipes, protecting a reference on the second page', async () => {
    const list = jest.fn().mockResolvedValue({
      data: [{ name: 'referenced.jpg', created_at: OLD }],
      error: null,
    });
    const remove = jest.fn();
    mockedStorageFrom.mockReturnValue({ list, remove });
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      original_photo_path: `household-1/originals/other-${i}.jpg`,
    }));
    const secondPage = [{ original_photo_path: 'household-1/originals/referenced.jpg' }];
    const { range } = mockRecipesQuery(() => ({ data: [], error: null }));
    range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });

    await sweepOrphanedOriginalPhotos('household-1');

    expect(range).toHaveBeenCalledTimes(2);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(remove).not.toHaveBeenCalled();
  });
});
