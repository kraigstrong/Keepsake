import { ensureImageCached, MAX_CACHE_BYTES, type ImageStore } from './imageCache';
import type { LocalDb } from './local';

function createMockDb(overrides: Partial<LocalDb> = {}): LocalDb & { runAsync: jest.Mock } {
  return {
    getFirstAsync: async <T,>() => null as T | null,
    getAllAsync: async <T,>() => [] as T[],
    runAsync: jest.fn(async () => undefined),
    withTransactionAsync: async (task) => {
      await task();
    },
    ...overrides,
  } as LocalDb & { runAsync: jest.Mock };
}

function createMockImageStore(overrides: Partial<ImageStore> = {}): ImageStore & {
  downloadTo: jest.Mock;
  deleteFile: jest.Mock;
} {
  return {
    ensureDirectory: jest.fn(),
    downloadTo: jest.fn(async () => ({ uri: 'file:///cache/hero-images/h1_r1.jpg', byteSize: 1000 })),
    deleteFile: jest.fn(),
    ...overrides,
  } as ImageStore & { downloadTo: jest.Mock; deleteFile: jest.Mock };
}

describe('ensureImageCached', () => {
  it('downloads and records a new image on a cache miss', async () => {
    const db = createMockDb();
    const imageStore = createMockImageStore();

    const uri = await ensureImageCached(db, 'h1/r1.jpg', 'https://signed.example/r1.jpg', imageStore);

    expect(imageStore.ensureDirectory).toHaveBeenCalled();
    expect(imageStore.downloadTo).toHaveBeenCalledWith('https://signed.example/r1.jpg', 'h1_r1.jpg');
    expect(uri).toBe('file:///cache/hero-images/h1_r1.jpg');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('insert into cached_images'),
      'h1/r1.jpg',
      'file:///cache/hero-images/h1_r1.jpg',
      1000,
      expect.any(String),
    );
  });

  it('returns the existing local file and just bumps last_accessed_at on a cache hit', async () => {
    const db = createMockDb({
      getFirstAsync: async <T,>() =>
        ({
          path: 'h1/r1.jpg',
          local_uri: 'file:///cache/hero-images/h1_r1.jpg',
          byte_size: 1000,
          last_accessed_at: '2026-08-01T00:00:00.000Z',
        }) as T,
    });
    const imageStore = createMockImageStore();

    const uri = await ensureImageCached(db, 'h1/r1.jpg', 'https://signed.example/r1.jpg', imageStore);

    expect(imageStore.downloadTo).not.toHaveBeenCalled();
    expect(uri).toBe('file:///cache/hero-images/h1_r1.jpg');
    expect(db.runAsync).toHaveBeenCalledWith(
      'update cached_images set last_accessed_at = ? where path = ?',
      expect.any(String),
      'h1/r1.jpg',
    );
  });

  it('evicts the least-recently-accessed images once the total exceeds the byte budget', async () => {
    // getAllAsync reflects post-insert state, as a real DB read would —
    // this fixture's total (MAX + 500) already exceeds budget on its own.
    const existingRows = [
      { path: 'old', local_uri: 'file:///old.jpg', byte_size: MAX_CACHE_BYTES - 500, last_accessed_at: '2026-08-01T00:00:00.000Z' },
      { path: 'newer', local_uri: 'file:///newer.jpg', byte_size: 1000, last_accessed_at: '2026-08-02T00:00:00.000Z' },
    ];
    const db = createMockDb({
      getFirstAsync: async <T,>() => null as T | null,
      getAllAsync: async <T,>() => existingRows as T[],
    });
    const imageStore = createMockImageStore({
      downloadTo: jest.fn(async () => ({ uri: 'file:///newer.jpg', byteSize: 1000 })),
    });

    await ensureImageCached(db, 'h1/newer.jpg', 'https://signed.example/newer.jpg', imageStore);

    // Total: (MAX-500) + 1000 = MAX+500 > MAX, so the oldest ("old") is
    // evicted first — that alone brings it back under budget.
    expect(imageStore.deleteFile).toHaveBeenCalledTimes(1);
    expect(imageStore.deleteFile).toHaveBeenCalledWith('file:///old.jpg');
    expect(db.runAsync).toHaveBeenCalledWith(
      'delete from cached_images where path = ?',
      'old',
    );
    expect(imageStore.deleteFile).not.toHaveBeenCalledWith('file:///newer.jpg');
  });

  it('does not evict anything when under budget', async () => {
    const db = createMockDb({
      getAllAsync: async <T,>() =>
        [{ path: 'r1', local_uri: 'file:///r1.jpg', byte_size: 500, last_accessed_at: '2026-08-01T00:00:00.000Z' }] as T[],
    });
    const imageStore = createMockImageStore();

    await ensureImageCached(db, 'h1/new.jpg', 'https://signed.example/new.jpg', imageStore);

    expect(imageStore.deleteFile).not.toHaveBeenCalled();
  });
});
