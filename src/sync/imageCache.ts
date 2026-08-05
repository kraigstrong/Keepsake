import { Directory, File, Paths } from 'expo-file-system';

import type { LocalDb } from './local';

const CACHE_DIRECTORY_NAME = 'hero-images';

// ADR-0013: a round, generous byte budget for a household's realistic
// photo count — not PRD-mandated, revisit if real usage says otherwise.
export const MAX_CACHE_BYTES = 100 * 1024 * 1024;

interface CachedImageRow {
  path: string;
  local_uri: string;
  byte_size: number;
  last_accessed_at: string;
}

/**
 * The filesystem operations imageCache.ts needs, abstracted so tests can
 * pass a plain mock instead of exercising expo-file-system's native
 * class-based API — same pattern as database.ts's MigratableDatabase and
 * local.ts's LocalDb.
 */
export interface ImageStore {
  ensureDirectory(): void;
  downloadTo(url: string, fileName: string): Promise<{ uri: string; byteSize: number }>;
  deleteFile(uri: string): void;
  // Removes the whole cache directory and everything in it in one call —
  // used by the sign-out wipe (ADR-0013), which clears the entire local
  // cache rather than deleting tracked files one row at a time.
  deleteDirectory(): void;
  // iOS is documented to purge Library/Caches/ under storage pressure at
  // any time — exactly where hero images live (ADR-0013). A
  // cached_images row surviving that purge (or pointing at a container
  // path that no longer exists at all) is a stale reference, not a real
  // cache hit; callers must check this before trusting local_uri rather
  // than assuming a DB row means the file is actually still there.
  fileExists(uri: string): boolean;
}

class ExpoImageStore implements ImageStore {
  private directory = new Directory(Paths.cache, CACHE_DIRECTORY_NAME);

  ensureDirectory(): void {
    if (!this.directory.exists) {
      this.directory.create({ intermediates: true });
    }
  }

  async downloadTo(url: string, fileName: string): Promise<{ uri: string; byteSize: number }> {
    const destination = new File(this.directory, fileName);
    const file = await File.downloadFileAsync(url, destination, { idempotent: true });
    return { uri: file.uri, byteSize: file.size };
  }

  deleteFile(uri: string): void {
    try {
      new File(uri).delete();
    } catch {
      // Already gone or inaccessible — eviction proceeds regardless; the
      // cached_images row is the source of truth for what's tracked.
    }
  }

  deleteDirectory(): void {
    try {
      if (this.directory.exists) {
        this.directory.delete();
      }
    } catch {
      // Already gone — a sign-out wipe with nothing cached yet is fine.
    }
  }

  fileExists(uri: string): boolean {
    try {
      return new File(uri).exists;
    } catch {
      // A URI from a container that no longer exists at all (e.g. after
      // a reinstall) throws rather than just reporting false — treat
      // that the same as "not there".
      return false;
    }
  }
}

export const defaultImageStore: ImageStore = new ExpoImageStore();

// Storage object paths look like "<household_id>/<uuid>.jpg" — flatten
// to avoid needing nested local directories.
function localFileNameFor(heroImagePath: string): string {
  return heroImagePath.replace(/\//g, '_');
}

/**
 * Returns a local file:// URI for the given hero image, downloading and
 * caching it on first use. A cache hit just bumps last_accessed_at
 * (LRU bookkeeping) and returns the existing local file.
 */
export async function ensureImageCached(
  db: LocalDb,
  heroImagePath: string,
  signedUrl: string,
  imageStore: ImageStore = defaultImageStore,
): Promise<string> {
  const existing = await db.getFirstAsync<CachedImageRow>(
    'select * from cached_images where path = ?',
    heroImagePath,
  );
  if (existing && imageStore.fileExists(existing.local_uri)) {
    await db.runAsync(
      'update cached_images set last_accessed_at = ? where path = ?',
      new Date().toISOString(),
      heroImagePath,
    );
    return existing.local_uri;
  }

  imageStore.ensureDirectory();
  const { uri, byteSize } = await imageStore.downloadTo(signedUrl, localFileNameFor(heroImagePath));

  await db.runAsync(
    `insert into cached_images (path, local_uri, byte_size, last_accessed_at)
     values (?, ?, ?, ?)
     on conflict (path) do update set
       local_uri = excluded.local_uri,
       byte_size = excluded.byte_size,
       last_accessed_at = excluded.last_accessed_at`,
    heroImagePath,
    uri,
    byteSize,
    new Date().toISOString(),
  );

  await evictOverBudget(db, imageStore);
  return uri;
}

// Oldest-accessed first, stopping as soon as the total drops back under
// budget — ADR-0013's storage-limit requirement.
async function evictOverBudget(db: LocalDb, imageStore: ImageStore): Promise<void> {
  const rows = await db.getAllAsync<CachedImageRow>(
    'select * from cached_images order by last_accessed_at asc',
  );
  let totalBytes = rows.reduce((sum, row) => sum + row.byte_size, 0);

  for (const row of rows) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    imageStore.deleteFile(row.local_uri);
    await db.runAsync('delete from cached_images where path = ?', row.path);
    totalBytes -= row.byte_size;
  }
}
