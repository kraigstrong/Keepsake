import { getDatabase } from '../db/database';
import type { Category, Recipe, RecipeSection } from '../recipes/api';
import { defaultImageStore, ensureImageCached, type ImageStore } from './imageCache';

// What Library's sort/filter (Phase 7) needs beyond a bare id/title —
// createdAt for the Smart-sort "Recently Added" tier (distinct from
// updated_at, which changes on every edit), categoryIds/tags for filters.
export interface LibraryRecipe {
  id: string;
  title: string;
  createdAt: string;
  categoryIds: string[];
  tags: string[];
}

interface LibraryRecipeRow {
  id: string;
  title: string;
  created_at: string | null;
  category_ids: string;
  tags: string;
}

interface LocalRecipeRow {
  id: string;
  version: number;
  title: string;
  hero_image_path: string | null;
  original_photo_path: string | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  yield_text: string | null;
  permanent_notes: string | null;
  source_url: string | null;
  source_attribution: string | null;
  tags: string;
  category_ids: string;
  ingredient_sections: string;
  instruction_sections: string;
}

function parseLocalRecipeRow(row: LocalRecipeRow): Recipe {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    heroImagePath: row.hero_image_path,
    originalPhotoPath: row.original_photo_path,
    activeTimeMinutes: row.active_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    yieldText: row.yield_text,
    permanentNotes: row.permanent_notes,
    sourceUrl: row.source_url,
    sourceAttribution: row.source_attribution,
    tags: JSON.parse(row.tags) as string[],
    categoryIds: JSON.parse(row.category_ids) as string[],
    ingredientSections: JSON.parse(row.ingredient_sections) as RecipeSection[],
    instructionSections: JSON.parse(row.instruction_sections) as RecipeSection[],
  };
}

// Local-first reads (ADR-0013 / OFF-01, OFF-02): the local recipes table
// is what screens read from, kept fresh by the sync engine — never a
// direct server fetch, so browsing works offline with no special-casing
// at the call site.
export async function readLocalLibraryRecipes(): Promise<LibraryRecipe[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<LibraryRecipeRow>(
    'select id, title, created_at, category_ids, tags from recipes order by title',
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    // Only null for a local row that hasn't gone through the schema v3
    // resync yet (see db/schema.ts's migration 3) — falls back to "epoch"
    // rather than "now" so an unmigrated row sorts as old, not
    // freshly-added, until the resync backfills the real value.
    createdAt: row.created_at ?? new Date(0).toISOString(),
    categoryIds: JSON.parse(row.category_ids) as string[],
    tags: JSON.parse(row.tags) as string[],
  }));
}

export async function readLocalRecipe(id: string): Promise<Recipe | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<LocalRecipeRow>('select * from recipes where id = ?', id);
  return row ? parseLocalRecipeRow(row) : null;
}

export async function readLocalCategories(): Promise<Category[]> {
  const db = await getDatabase();
  return db.getAllAsync<Category>(
    'select id, group_name as groupName, value from categories order by value',
  );
}

// Null when the image hasn't been cached yet (e.g. sync hasn't reached it,
// or it failed best-effort) *or* when a cached row exists but the file
// it points to doesn't anymore — iOS is documented to purge
// Library/Caches/ under storage pressure at any time, exactly where
// hero images live (ADR-0013), so a DB row alone doesn't mean the file
// survived. Either way, the caller falls back to a live signed URL.
export async function readCachedImageUri(
  heroImagePath: string,
  imageStore: ImageStore = defaultImageStore,
): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ local_uri: string }>(
    'select local_uri from cached_images where path = ?',
    heroImagePath,
  );
  if (!row) return null;
  return imageStore.fileExists(row.local_uri) ? row.local_uri : null;
}

/**
 * Downloads and caches a hero image whose signed URL a screen just
 * resolved on a cache miss, so the *next* view of this recipe is a
 * cache hit instead of re-fetching a signed URL and re-downloading over
 * the network every single time. Sync's own pre-caching (Phase 6,
 * syncEngine.ts) only reaches a recipe on its next full sync pass,
 * which a recipe from a just-completed import hasn't had yet — this is
 * what closes that gap for the common "view it right after importing"
 * case instead of leaving every such view slow indefinitely.
 */
export async function cacheHeroImage(
  heroImagePath: string,
  signedUrl: string,
  imageStore: ImageStore = defaultImageStore,
): Promise<string> {
  const db = await getDatabase();
  return ensureImageCached(db, heroImagePath, signedUrl, imageStore);
}
