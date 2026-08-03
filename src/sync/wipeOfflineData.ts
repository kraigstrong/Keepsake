import { wipeDatabase } from '../db/database';
import { defaultImageStore, type ImageStore } from './imageCache';

/**
 * Sign-out wipe (ADR-0013): the whole local SQLite database file plus
 * the entire cached-hero-image directory — not a per-household filtered
 * delete, since MVP is one household per user (ADR-0004) so there's
 * never a second household's cache to preserve.
 */
export async function wipeOfflineData(imageStore: ImageStore = defaultImageStore): Promise<void> {
  await wipeDatabase();
  imageStore.deleteDirectory();
}
