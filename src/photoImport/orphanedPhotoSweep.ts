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

// supabase/config.toml's [api] max_rows — the Data API silently caps any
// single response at this many rows rather than erroring, so a single
// unpaginated select/list can silently omit rows past the cap instead of
// signaling truncation. For a query that decides what's safe to
// permanently delete, an incomplete "referenced paths" result must never
// be mistaken for a complete one — a genuinely-referenced original past
// the cap would otherwise read as orphaned (Codex review, PR #76).
// Paginate both the Storage listing and the recipes query until a page
// comes back short, with an explicit stable sort so two calls can't skip
// or duplicate a row purely from unordered-scan nondeterminism.
const PAGE_SIZE = 1000;

async function fetchAllPages<T>(
  fetchPage: (offset: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[] } | { error: unknown }> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await fetchPage(offset);
    if (error) return { error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { data: all };
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
// Deliberately checks recipes.original_photo_path only, not
// import_jobs.photo_path — a photo import is synchronous (ADR-0017
// decision 4), so a job still sitting in 'processing' 30+ days after
// upload is already dead in practice (nothing polls it that long); the
// same "abandoned, not just slow" read the outbox's own expiry already
// applies. Treating it as still-needed would make the sweep never able
// to close the exact stuck-job case T15 exists for.
export async function sweepOrphanedOriginalPhotos(householdId: string): Promise<void> {
  const objectsResult = await fetchAllPages<StorageOriginalPhotoListing>((offset) =>
    supabase.storage.from('recipe-images').list(`${householdId}/originals`, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    }),
  );

  if ('error' in objectsResult) {
    logError(objectsResult.error, { context: 'sweepOrphanedOriginalPhotos.list' });
    return;
  }
  const objects = objectsResult.data;
  if (objects.length === 0) return;

  const recipesResult = await fetchAllPages<{ original_photo_path: string }>(async (offset) => {
    return await supabase
      .from('recipes')
      .select('original_photo_path')
      .not('original_photo_path', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
  });

  if ('error' in recipesResult) {
    logError(recipesResult.error, { context: 'sweepOrphanedOriginalPhotos.query' });
    return;
  }

  const referencedPaths = new Set(recipesResult.data.map((row) => row.original_photo_path));

  const orphaned = findOrphanedOriginalPhotos(householdId, objects, referencedPaths, new Date());
  if (orphaned.length === 0) return;

  const { error: removeError } = await supabase.storage.from('recipe-images').remove(orphaned);
  if (removeError) {
    logError(removeError, { context: 'sweepOrphanedOriginalPhotos.remove' });
  }
}
