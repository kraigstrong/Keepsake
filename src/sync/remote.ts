import { supabase } from '../supabase/instance';
import type { Category } from '../recipes/api';
import { SYNC_PAGE_SIZE, type DeletedRecipeTombstone, type SyncedRecipe } from './types';

/**
 * No generated Supabase types exist yet (see src/household/api.ts's note)
 * — documents the actual nested-embed row shape rather than `as any`.
 */
interface FetchedSection<TLines> {
  title: string | null;
  sort_order: number;
  recipe_ingredients?: TLines[];
  recipe_instructions?: TLines[];
}
interface FetchedLine {
  line_text: string;
  sort_order: number;
}
interface FetchedRecipeRow {
  id: string;
  household_id: string;
  version: number;
  title: string;
  hero_image_path: string | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  yield_text: string | null;
  permanent_notes: string | null;
  source_url: string | null;
  source_attribution: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  recipe_ingredient_sections: FetchedSection<FetchedLine>[];
  recipe_instruction_sections: FetchedSection<FetchedLine>[];
  recipe_categories: { category_id: string }[];
}

function bySortOrder<T extends { sort_order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

function toSyncedRecipe(row: FetchedRecipeRow): SyncedRecipe {
  return {
    id: row.id,
    householdId: row.household_id,
    version: row.version,
    title: row.title,
    heroImagePath: row.hero_image_path,
    activeTimeMinutes: row.active_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    yieldText: row.yield_text,
    permanentNotes: row.permanent_notes,
    sourceUrl: row.source_url,
    sourceAttribution: row.source_attribution,
    tags: row.tags,
    categoryIds: row.recipe_categories.map((c) => c.category_id),
    ingredientSections: bySortOrder(row.recipe_ingredient_sections).map((section) => ({
      title: section.title,
      lines: bySortOrder(section.recipe_ingredients ?? []).map((line) => line.line_text),
    })),
    instructionSections: bySortOrder(row.recipe_instruction_sections).map((section) => ({
      title: section.title,
      lines: bySortOrder(section.recipe_instructions ?? []).map((line) => line.line_text),
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// (updated_at, id) > (cursorUpdatedAt, cursorId) as a PostgREST `or`
// filter, since the JS client has no direct tuple-comparison operator —
// ADR-0013's cursor shape. Null cursor = initial sync, no filter at all.
function afterCursorFilter(column: string, cursorValue: string | null, cursorId: string | null) {
  if (!cursorValue || !cursorId) return null;
  return `${column}.gt.${cursorValue},and(${column}.eq.${cursorValue},id.gt.${cursorId})`;
}

export async function fetchChangedRecipes(
  cursorUpdatedAt: string | null,
  cursorId: string | null,
  limit: number = SYNC_PAGE_SIZE,
): Promise<SyncedRecipe[]> {
  let query = supabase.from('recipes').select(
    `id, household_id, version, title, hero_image_path, active_time_minutes, total_time_minutes,
       yield_text, permanent_notes, source_url, source_attribution, tags, created_at, updated_at,
       recipe_ingredient_sections ( title, sort_order, recipe_ingredients ( line_text, sort_order ) ),
       recipe_instruction_sections ( title, sort_order, recipe_instructions ( line_text, sort_order ) ),
       recipe_categories ( category_id )`,
  );

  const filter = afterCursorFilter('updated_at', cursorUpdatedAt, cursorId);
  if (filter) query = query.or(filter);

  const { data, error } = await query
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data as unknown as FetchedRecipeRow[]).map(toSyncedRecipe);
}

export async function fetchDeletedRecipes(
  cursorDeletedAt: string | null,
  cursorId: string | null,
  limit: number = SYNC_PAGE_SIZE,
): Promise<DeletedRecipeTombstone[]> {
  let query = supabase.from('deleted_recipes').select('id, household_id, deleted_at');

  const filter = afterCursorFilter('deleted_at', cursorDeletedAt, cursorId);
  if (filter) query = query.or(filter);

  const { data, error } = await query
    .order('deleted_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data as { id: string; household_id: string; deleted_at: string }[]).map((row) => ({
    id: row.id,
    householdId: row.household_id,
    deletedAt: row.deleted_at,
  }));
}

export async function fetchAllCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, group_name, value')
    .order('value');
  if (error) throw error;
  return (data as { id: string; group_name: Category['groupName']; value: string }[]).map(
    (row) => ({ id: row.id, groupName: row.group_name, value: row.value }),
  );
}
