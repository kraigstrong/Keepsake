import { supabase } from '../supabase/instance';

export interface RecipeSummary {
  id: string;
  title: string;
}

export interface RecipeSection {
  title: string | null;
  lines: string[];
}

export type CategoryGroup = 'protein' | 'dish_type' | 'preparation';

export interface Category {
  id: string;
  groupName: CategoryGroup;
  value: string;
}

export interface Recipe {
  id: string;
  title: string;
  heroImagePath: string | null;
  activeTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  yieldText: string | null;
  permanentNotes: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: RecipeSection[];
  instructionSections: RecipeSection[];
}

export interface RecipeSavePayload {
  id?: string;
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

export async function fetchRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase.from('recipes').select('id, title').order('title');
  if (error) throw error;
  return (data as { id: string; title: string }[]).map((row) => ({
    id: row.id,
    title: row.title,
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
interface FetchedRecipeRow {
  id: string;
  title: string;
  hero_image_path: string | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  yield_text: string | null;
  permanent_notes: string | null;
  source_url: string | null;
  source_attribution: string | null;
  tags: string[];
  recipe_ingredient_sections: FetchedSection<FetchedLine>[];
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
      `id, title, hero_image_path, active_time_minutes, total_time_minutes, yield_text,
       permanent_notes, source_url, source_attribution, tags,
       recipe_ingredient_sections ( title, sort_order, recipe_ingredients ( line_text, sort_order ) ),
       recipe_instruction_sections ( title, sort_order, recipe_instructions ( line_text, sort_order ) ),
       recipe_categories ( category_id )`,
    )
    .eq('id', id)
    .single();

  if (error) throw error;
  const row = data as unknown as FetchedRecipeRow;

  return {
    id: row.id,
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
  };
}

export async function saveRecipe(payload: RecipeSavePayload): Promise<{ id: string }> {
  const { data, error } = await supabase
    .rpc('save_recipe', {
      payload: {
        id: payload.id ?? null,
        title: payload.title,
        heroImagePath: payload.heroImagePath ?? null,
        activeTimeMinutes: payload.activeTimeMinutes ?? null,
        totalTimeMinutes: payload.totalTimeMinutes ?? null,
        yieldText: payload.yieldText ?? null,
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
  return { id: (data as { id: string }).id };
}
