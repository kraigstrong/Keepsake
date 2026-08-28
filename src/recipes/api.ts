import type { ParsedIngredientLine } from '../../server/units/parseQuantity';
import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';

export interface RecipeSummary {
  id: string;
  title: string;
  servingsCount: number | null;
}

// Plain-text lines — instructions always, and ingredients while being
// edited (ADR-0010: no structured input form; ADR-0018: parsing only
// happens at the save_recipe call site, not in the editor's own
// state).
export interface RecipeSection {
  title: string | null;
  lines: string[];
}

// A saved/fetched ingredient section: each line carries its parsed
// quantity fields alongside the original text (ADR-0018). A line the
// parser couldn't confidently read has every structured field null.
export interface IngredientSection {
  title: string | null;
  lines: ParsedIngredientLine[];
}

export type CategoryGroup = 'protein' | 'dish_type' | 'preparation';

export interface Category {
  id: string;
  groupName: CategoryGroup;
  value: string;
}

export interface Recipe {
  id: string;
  version: number;
  title: string;
  heroImagePath: string | null;
  // IMG-02/IMG-03 (Phase 10, ADR-0017): the preserved original a photo
  // import was created from, set only at creation — never editable
  // through save_recipe's update branch, so replacing/removing the hero
  // image (Phase 4) never touches it. Read-only here for that reason;
  // absent from RecipeSavePayload below.
  originalPhotoPath: string | null;
  activeTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  yieldText: string | null;
  // Parsed from yieldText (ADR-0018) — null unless yieldText clearly
  // names a single serving count. Recipes without one still scale via
  // the 1/2x-4x presets, just not an arbitrary serving-count stepper.
  servingsCount: number | null;
  permanentNotes: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: IngredientSection[];
  instructionSections: RecipeSection[];
  // Phase 16 (ADR-0025) — read-only here, same reasoning as
  // originalPhotoPath: neither is ever set through save_recipe's
  // update branch, only through the dedicated archive_recipe/
  // delete_recipe/etc RPCs, so RecipeSavePayload below doesn't carry
  // them.
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface RecipeSavePayload {
  id?: string;
  baseVersion?: number;
  title: string;
  heroImagePath?: string | null;
  activeTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  yieldText?: string | null;
  servingsCount?: number | null;
  permanentNotes?: string | null;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: IngredientSection[];
  instructionSections: RecipeSection[];
}

// Everything an in-progress edit needs to persist as a draft. Distinct
// from RecipeSavePayload (rather than an Omit of it) because a draft's
// ingredient lines are still plain edited text — parsing only happens
// once, at the actual save_recipe call (ADR-0018) — and servingsCount
// is derived from yieldText at that same point, not stored mid-edit.
export interface RecipeDraftPayload {
  title: string;
  heroImagePath?: string | null;
  activeTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  yieldText?: string | null;
  permanentNotes?: string | null;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: RecipeSection[];
  instructionSections: RecipeSection[];
}

export interface RecipeVersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
}

// save_recipe raises this exact message (errcode P0001) when the
// caller's baseVersion no longer matches the row's current version —
// the one error saveRecipe() needs callers to be able to distinguish
// from every other failure, since it's the trigger for conflict UI
// rather than a generic error state.
const CONFLICT_MESSAGE = 'recipe has changed since it was loaded';

export function isRecipeConflictError(error: unknown): boolean {
  return error instanceof Error && error.message === CONFLICT_MESSAGE;
}

// AddToThisWeekScreen's picker — excludes archived/deleted recipes
// (Phase 16, ADR-0025), same as Library/Search; you can't plan a recipe
// you can't currently see.
export async function fetchRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, servings_count')
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('title');
  if (error) throw error;
  return (data as { id: string; title: string; servings_count: number | null }[]).map((row) => ({
    id: row.id,
    title: row.title,
    servingsCount: row.servings_count,
  }));
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, group_name, value')
    .order('value');
  if (error) throw error;
  return (data as { id: string; group_name: CategoryGroup; value: string }[]).map((row) => ({
    id: row.id,
    groupName: row.group_name,
    value: row.value,
  }));
}

/**
 * No generated Supabase types exist yet (see src/household/api.ts) —
 * this documents the actual shape of the nested-embed query below rather
 * than leaving `as any` at the call site.
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
interface FetchedIngredientLine extends FetchedLine {
  quantity_min: number | null;
  quantity_max: number | null;
  unit: string | null;
  ingredient_text: string | null;
}
interface FetchedRecipeRow {
  id: string;
  version: number;
  title: string;
  hero_image_path: string | null;
  original_photo_path: string | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  yield_text: string | null;
  servings_count: number | null;
  permanent_notes: string | null;
  source_url: string | null;
  source_attribution: string | null;
  tags: string[];
  archived_at: string | null;
  deleted_at: string | null;
  recipe_ingredient_sections: FetchedSection<FetchedIngredientLine>[];
  recipe_instruction_sections: FetchedSection<FetchedLine>[];
  recipe_categories: { category_id: string }[];
}

function bySortOrder<T extends { sort_order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

export async function fetchRecipe(id: string): Promise<Recipe> {
  const { data, error } = await supabase
    .from('recipes')
    .select(
      `id, version, title, hero_image_path, original_photo_path, active_time_minutes, total_time_minutes, yield_text,
       servings_count, permanent_notes, source_url, source_attribution, tags, archived_at, deleted_at,
       recipe_ingredient_sections (
         title, sort_order,
         recipe_ingredients ( line_text, quantity_min, quantity_max, unit, ingredient_text, sort_order )
       ),
       recipe_instruction_sections ( title, sort_order, recipe_instructions ( line_text, sort_order ) ),
       recipe_categories ( category_id )`,
    )
    .eq('id', id)
    .single();

  if (error) throw error;
  const row = data as unknown as FetchedRecipeRow;

  return {
    id: row.id,
    version: row.version,
    title: row.title,
    heroImagePath: row.hero_image_path,
    originalPhotoPath: row.original_photo_path,
    activeTimeMinutes: row.active_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    yieldText: row.yield_text,
    servingsCount: row.servings_count,
    permanentNotes: row.permanent_notes,
    sourceUrl: row.source_url,
    sourceAttribution: row.source_attribution,
    tags: row.tags,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    categoryIds: row.recipe_categories.map((c) => c.category_id),
    ingredientSections: bySortOrder(row.recipe_ingredient_sections).map((section) => ({
      title: section.title,
      lines: bySortOrder(section.recipe_ingredients ?? []).map((line) => ({
        lineText: line.line_text,
        quantityMin: line.quantity_min,
        quantityMax: line.quantity_max,
        unit: line.unit as ParsedIngredientLine['unit'],
        ingredientText: line.ingredient_text,
      })),
    })),
    instructionSections: bySortOrder(row.recipe_instruction_sections).map((section) => ({
      title: section.title,
      lines: bySortOrder(section.recipe_instructions ?? []).map((line) => line.line_text),
    })),
  };
}

export async function saveRecipe(payload: RecipeSavePayload): Promise<{ id: string }> {
  const { data, error } = await supabase
    .rpc('save_recipe', {
      payload: {
        id: payload.id ?? null,
        baseVersion: payload.baseVersion ?? null,
        title: payload.title,
        heroImagePath: payload.heroImagePath ?? null,
        activeTimeMinutes: payload.activeTimeMinutes ?? null,
        totalTimeMinutes: payload.totalTimeMinutes ?? null,
        yieldText: payload.yieldText ?? null,
        servingsCount: payload.servingsCount ?? null,
        permanentNotes: payload.permanentNotes ?? null,
        sourceUrl: payload.sourceUrl ?? null,
        sourceAttribution: payload.sourceAttribution ?? null,
        tags: payload.tags,
        categoryIds: payload.categoryIds,
        ingredientSections: payload.ingredientSections,
        instructionSections: payload.instructionSections,
      },
    })
    .single();

  if (error) throw error;
  // isNew distinguishes creating a recipe from editing one — the former
  // is the activation signal, the latter engagement. A boolean, not the
  // id: no recipe identity in analytics (PRD §30, SEC-05).
  trackEvent('recipe_saved', { isNew: payload.id == null });
  return { id: (data as { id: string }).id };
}

export async function fetchRecipeVersions(recipeId: string): Promise<RecipeVersionSummary[]> {
  const { data, error } = await supabase
    .from('recipe_versions')
    .select('id, version_number, created_at')
    .eq('recipe_id', recipeId)
    .order('version_number', { ascending: false });

  if (error) throw error;
  return (data as { id: string; version_number: number; created_at: string }[]).map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    createdAt: row.created_at,
  }));
}

export async function restoreRecipeVersion(versionId: string): Promise<{ id: string }> {
  const { data, error } = await supabase
    .rpc('restore_recipe_version', { target_version_id: versionId })
    .single();

  if (error) throw error;
  return { id: (data as { id: string }).id };
}

export async function fetchDraft(recipeId: string | null): Promise<RecipeDraftPayload | null> {
  let query = supabase.from('recipe_drafts').select('draft_payload');
  query = recipeId ? query.eq('recipe_id', recipeId) : query.is('recipe_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as { draft_payload: RecipeDraftPayload } | null)?.draft_payload ?? null;
}

export async function saveDraft(
  recipeId: string | null,
  payload: RecipeDraftPayload,
): Promise<void> {
  const { error } = await supabase.rpc('upsert_draft', {
    recipe_id_param: recipeId,
    draft_payload_param: payload,
  });
  if (error) throw error;
}

export async function deleteDraft(recipeId: string | null): Promise<void> {
  const { error } = await supabase.rpc('delete_draft', { recipe_id_param: recipeId });
  if (error) throw error;
}

// Phase 16 (ADR-0025). Confirmation is the caller's job (decision 9) —
// these just perform the action once asked.
export async function archiveRecipe(recipeId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_recipe', { recipe_id: recipeId });
  if (error) throw error;
}

export async function unarchiveRecipe(recipeId: string): Promise<void> {
  const { error } = await supabase.rpc('unarchive_recipe', { recipe_id: recipeId });
  if (error) throw error;
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_recipe', { recipe_id: recipeId });
  if (error) throw error;
}

export async function restoreRecipe(recipeId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_recipe', { recipe_id: recipeId });
  if (error) throw error;
}

// LIFE-07. The RPC returns the doomed row's Storage paths rather than
// deleting them itself (ADR-0025 decision 4); a cleanup failure here is
// swallowed, not rethrown — the recipe row is already gone by this
// point, and an orphaned object is the same accepted low-severity gap
// as T15, not a reason to surface an error for an action that, from the
// user's perspective, already completed.
export async function permanentlyDeleteRecipe(recipeId: string): Promise<void> {
  const { data, error } = await supabase.rpc('permanently_delete_recipe', {
    recipe_id: recipeId,
  });
  if (error) throw error;

  const row = (data as { hero_image_path: string | null; original_photo_path: string | null }[])[0];
  const paths = [row?.hero_image_path, row?.original_photo_path].filter(
    (path): path is string => path != null,
  );
  if (paths.length === 0) return;

  await supabase.storage.from('recipe-images').remove(paths);
}

export interface ArchivedRecipeSummary {
  id: string;
  title: string;
  archivedAt: string;
}

export async function fetchArchivedRecipes(): Promise<ArchivedRecipeSummary[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, archived_at')
    .not('archived_at', 'is', null)
    .is('deleted_at', null)
    .order('archived_at', { ascending: false });
  if (error) throw error;
  return (data as { id: string; title: string; archived_at: string }[]).map((row) => ({
    id: row.id,
    title: row.title,
    archivedAt: row.archived_at,
  }));
}

export interface DeletedRecipeSummary {
  id: string;
  title: string;
  deletedAt: string;
}

export async function fetchDeletedRecipes(): Promise<DeletedRecipeSummary[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, deleted_at')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return (data as { id: string; title: string; deleted_at: string }[]).map((row) => ({
    id: row.id,
    title: row.title,
    deletedAt: row.deleted_at,
  }));
}
