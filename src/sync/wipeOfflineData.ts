import { clearQueuedShares } from '../appGroup/appGroupHandoff';
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

/**
 * Account deletion's wipe (ADR-0028). Same as sign-out plus the two
 * outboxes, which sign-out deliberately preserves: an unsent capture is
 * normally the only copy of itself, but after deletion its household_id
 * points somewhere this user can no longer write, so it would retry
 * forever. This does not change what sign-out does.
 */
export async function wipeOfflineDataForAccountDeletion(
  imageStore: ImageStore = defaultImageStore,
): Promise<void> {
  await wipeDatabase({ includeOutboxes: true });
  imageStore.deleteDirectory();
  // The native share-inbox is a third queue, outside SQLite entirely. A
  // payload the extension wrote but the app never drained would otherwise
  // survive, and submit under whichever household signs in next.
  clearQueuedShares();
}
