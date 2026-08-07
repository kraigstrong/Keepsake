import { supabase } from '../supabase/instance';
import { currentWeekKey } from './weekKey';

export type WeeklyPlanStatus = 'planning' | 'confirmed';

export interface ThisWeekEntry {
  id: string;
  recipeId: string;
  title: string;
  heroImagePath: string | null;
  servings: number;
  position: number;
}

export interface ThisWeekPlan {
  id: string;
  status: WeeklyPlanStatus;
  entries: ThisWeekEntry[];
}

interface WeeklyPlanRow {
  id: string;
  status: WeeklyPlanStatus;
}

interface PlanningEntryRow {
  id: string;
  recipe_id: string;
  servings: number;
  position: number;
  recipe: { title: string; hero_image_path: string | null } | null;
}

/**
 * Always online (OFF-04, ADR-0021) — direct Postgrest/RPC calls, no
 * src/sync/* offline mirror involved. Re-fetch after every mutation and
 * on screen focus is how a co-member's change becomes visible (no
 * Realtime subscription in this app yet, ADR-0021).
 */
export async function fetchCurrentWeeklyPlan(): Promise<ThisWeekPlan> {
  const { data: plan, error: planError } = await supabase
    .rpc('get_or_create_current_weekly_plan', { week_key_param: currentWeekKey() })
    .single();
  if (planError || !plan) {
    throw new Error(planError?.message ?? "Could not load this week's plan");
  }
  const planRow = plan as WeeklyPlanRow;

  const { data: entries, error: entriesError } = await supabase
    .from('planning_entries')
    .select('id, recipe_id, servings, position, recipe:recipes(title, hero_image_path)')
    .eq('weekly_plan_id', planRow.id)
    .order('position');
  if (entriesError) {
    throw new Error(entriesError.message);
  }

  return {
    id: planRow.id,
    status: planRow.status,
    entries: ((entries ?? []) as unknown as PlanningEntryRow[]).map((row) => ({
      id: row.id,
      recipeId: row.recipe_id,
      title: row.recipe?.title ?? '',
      heroImagePath: row.recipe?.hero_image_path ?? null,
      servings: row.servings,
      position: row.position,
    })),
  };
}

export async function addRecipeToThisWeek(
  planId: string,
  recipeId: string,
  servings: number,
): Promise<void> {
  const { error } = await supabase.rpc('add_to_weekly_plan', {
    plan_id: planId,
    recipe_id: recipeId,
    servings,
  });
  if (error) throw new Error(error.message);
}

export interface ThisWeekSelection {
  recipeId: string;
  servings: number;
}

// Batch counterpart of addRecipeToThisWeek — one atomic RPC call for the
// whole reviewed selection (Codex review, PR #36), not a client-side
// loop: a mid-loop failure used to leave a partially-applied selection
// that could duplicate entries on retry. Parallel arrays match
// add_recipes_to_weekly_plan's own parameter shape (PostgREST has no
// array-of-objects RPC parameter type).
export async function addRecipesToThisWeek(
  planId: string,
  selections: ThisWeekSelection[],
): Promise<void> {
  const { error } = await supabase.rpc('add_recipes_to_weekly_plan', {
    plan_id: planId,
    recipe_ids: selections.map((s) => s.recipeId),
    servings_list: selections.map((s) => s.servings),
  });
  if (error) throw new Error(error.message);
}

export async function reorderThisWeek(planId: string, orderedEntryIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_planning_entries', {
    plan_id: planId,
    ordered_entry_ids: orderedEntryIds,
  });
  if (error) throw new Error(error.message);
}

export async function removeFromThisWeek(entryId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_planning_entry', { entry_id: entryId });
  if (error) throw new Error(error.message);
}

export async function confirmThisWeek(planId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_weekly_plan', { plan_id: planId });
  if (error) throw new Error(error.message);
}

export async function reopenThisWeek(planId: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_weekly_plan', { plan_id: planId });
  if (error) throw new Error(error.message);
}
