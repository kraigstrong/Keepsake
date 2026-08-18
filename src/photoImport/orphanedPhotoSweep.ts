import { logError } from '../observability';
import { supabase } from '../supabase/instance';

// T15 (docs/threat-model.md, ADR-0017 decision 2): upload-before-processing
// means a preserved original can end up in Storage with nothing in the
// database ever referencing it — either the app died between the upload
// and create_import_job, or the import job was created and later failed
// (fail_import_job never touches photo_path or the Storage object). Same
// 30-day threshold as import/outboxEngine.ts's OUTBOX_EXPIRY_MS ("Staging
// data expires") — generous for a real gap in usage, still bounded.
const ORIGINAL_PHOTO_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface StorageOriginalPhotoListing {
  name: string;
  created_at: string | null;
}

/**
 * Pure diff: which of this household's originals/ objects are both
 * unreferenced by any recipe row and old enough to be a real orphan
 * rather than an import still in flight. `objects` are as returned by
 * Storage's list() — names relative to the listed `<household_id>/
 * originals` prefix, not full paths; `referencedPaths` are full paths
 * (how `recipes.original_photo_path` is actually stored, see
 * uploadOriginalPhoto). Returns full paths, ready for storage.remove().
 */
export function findOrphanedOriginalPhotos(
  householdId: string,
  objects: readonly StorageOriginalPhotoListing[],
  referencedPaths: ReadonlySet<string>,
  now: Date,
): string[] {
  return objects
    .filter((object) => object.created_at !== null)
    .filter(
      (object) => now.getTime() - new Date(object.created_at!).getTime() > ORIGINAL_PHOTO_EXPIRY_MS,
    )
    .map((object) => `${householdId}/originals/${object.name}`)
    .filter((path) => !referencedPaths.has(path));
}

/**
 * Client-driven sweep — no server infra involved (docs/architecture.md:
 * this app's runtime never touches the service-role key, so a
 * bucket-wide scheduled job isn't an option without adding one). Reuses
 * the same household-scoped Storage RLS a signed-in member already has
 * (supabase/migrations/20260802120800_recipe_images_storage.sql), the
 * same way ADR-0025 decision 4's delete-cleanup already does client-side
 * Storage deletes. Housekeeping only — failures are logged, never
 * surfaced to the user, matching how outbox drain failures are handled.
 */
export async function sweepOrphanedOriginalPhotos(householdId: string): Promise<void> {
  const { data: objects, error: listError } = await supabase.storage
    .from('recipe-images')
    .list(`${householdId}/originals`, { limit: 1000 });

  if (listError) {
    logError(listError, { context: 'sweepOrphanedOriginalPhotos.list' });
    return;
  }
  if (!objects || objects.length === 0) return;

  const { data: recipes, error: queryError } = await supabase
    .from('recipes')
    .select('original_photo_path')
    .not('original_photo_path', 'is', null);

  if (queryError) {
    logError(queryError, { context: 'sweepOrphanedOriginalPhotos.query' });
    return;
  }

  const referencedPaths = new Set((recipes ?? []).map((row) => row.original_photo_path as string));

  const orphaned = findOrphanedOriginalPhotos(householdId, objects, referencedPaths, new Date());
  if (orphaned.length === 0) return;

  const { error: removeError } = await supabase.storage.from('recipe-images').remove(orphaned);
  if (removeError) {
    logError(removeError, { context: 'sweepOrphanedOriginalPhotos.remove' });
  }
}
