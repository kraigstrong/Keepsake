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

describe('sweepOrphanedOriginalPhotos', () => {
  afterEach(() => jest.clearAllMocks());

  it('does nothing when the originals/ listing is empty', async () => {
    const list = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedStorageFrom.mockReturnValue({ list });

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedStorageFrom).toHaveBeenCalledWith('recipe-images');
    expect(list).toHaveBeenCalledWith('household-1/originals', { limit: 1000 });
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
    const notFn = jest.fn().mockResolvedValue({ data: null, error: queryError });
    mockedFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ not: notFn }) });

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
    const notFn = jest.fn().mockResolvedValue({
      data: [{ original_photo_path: 'household-1/originals/referenced.jpg' }],
      error: null,
    });
    mockedFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ not: notFn }) });

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
    const notFn = jest.fn().mockResolvedValue({
      data: [{ original_photo_path: 'household-1/originals/referenced.jpg' }],
      error: null,
    });
    mockedFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ not: notFn }) });

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
    const notFn = jest.fn().mockResolvedValue({ data: [], error: null });
    mockedFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ not: notFn }) });

    await sweepOrphanedOriginalPhotos('household-1');

    expect(mockedLogError).toHaveBeenCalledWith(removeError, {
      context: 'sweepOrphanedOriginalPhotos.remove',
    });
  });
});
