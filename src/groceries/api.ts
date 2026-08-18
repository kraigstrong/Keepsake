import type { UnitSystem } from '../../server/units/quantityVocabulary';
import type { ParsedIngredientLine } from '../../server/units/parseQuantity';
import {
  generateGroceryList,
  type GroceryItem,
  type PlanningEntryForGroceries,
} from '../../server/groceries/generateGroceryList';
import { supabase } from '../supabase/instance';

export type { GroceryItem } from '../../server/groceries/generateGroceryList';
export type { GroceryCategory } from '../../server/groceries/categoryDictionary';

// A staple defaults to excluded; everything else defaults to included
// (ADR-0022 decision 5) — grocery_item_selections only ever holds a
// row for an item the caller has explicitly toggled away from that
// default (decision 7), so an item with no row falls back to it here.
export interface GroceryReviewItem extends GroceryItem {
  included: boolean;
}

export interface GroceryReviewList {
  planId: string;
  items: GroceryReviewItem[];
}

// Thrown by fetchGroceryReview when the plan isn't confirmed yet — a
// stale/deep link, or a co-member reopening the plan for editing while
// this screen is open, would otherwise render a fully interactive-
// looking list whose every toggle then gets rejected by the RPC
// (Codex review, PR #45). A string constant, not an error subclass:
// this codebase has no error-hierarchy convention to extend, and the
// caller only ever needs to compare messages, same as every other
// thrown-Error(message) path in this file.
export const GROCERY_REVIEW_PLAN_NOT_CONFIRMED =
  "This week's plan needs to be confirmed before groceries can be reviewed.";

interface FetchedWeeklyPlanRow {
  status: string;
}
interface FetchedIngredientLine {
  line_text: string;
  quantity_min: number | null;
  quantity_max: number | null;
  unit: string | null;
  ingredient_text: string | null;
}
interface FetchedPlanningEntryRow {
  recipe_id: string;
  multiplier: number;
  recipe: {
    recipe_ingredient_sections: { recipe_ingredients: FetchedIngredientLine[] }[];
  } | null;
}

function toParsedLine(line: FetchedIngredientLine): ParsedIngredientLine {
  return {
    lineText: line.line_text,
    quantityMin: line.quantity_min,
    quantityMax: line.quantity_max,
    unit: line.unit as ParsedIngredientLine['unit'],
    ingredientText: line.ingredient_text,
  };
}

/**
 * The grocery list itself is never persisted (ADR-0022) — this
 * recomputes it from the plan's current, RLS-authorized data on every
 * call, then overlays any explicit include/exclude overrides the
 * household has already recorded for this plan.
 *
 * preferredUnitSystem is the caller's own responsibility to resolve
 * (fetchProfile, same as CookingModeScreen/RecipeDetailScreen) — this
 * function stays a thin RLS-scoped fetch-and-compute layer, not a place
 * that reaches into the current user's profile itself.
 */
export async function fetchGroceryReview(
  planId: string,
  preferredUnitSystem: UnitSystem | null = null,
): Promise<GroceryReviewList> {
  const { data: plan, error: planError } = await supabase
    .from('weekly_plans')
    .select('status')
    .eq('id', planId)
    .single();
  if (planError) throw new Error(planError.message);
  if ((plan as unknown as FetchedWeeklyPlanRow).status !== 'confirmed') {
    throw new Error(GROCERY_REVIEW_PLAN_NOT_CONFIRMED);
  }

  const { data: entries, error: entriesError } = await supabase
    .from('planning_entries')
    .select(
      `recipe_id, multiplier,
       recipe:recipes (
         recipe_ingredient_sections (
           recipe_ingredients ( line_text, quantity_min, quantity_max, unit, ingredient_text )
         )
       )`,
    )
    .eq('weekly_plan_id', planId);
  if (entriesError) throw new Error(entriesError.message);

  const planningEntries: PlanningEntryForGroceries[] = (
    (entries ?? []) as unknown as FetchedPlanningEntryRow[]
  ).map((row) => ({
    recipeId: row.recipe_id,
    multiplier: row.multiplier,
    ingredientLines: (row.recipe?.recipe_ingredient_sections ?? []).flatMap((section) =>
      section.recipe_ingredients.map(toParsedLine),
    ),
  }));

  const items = generateGroceryList(planningEntries, preferredUnitSystem);

  const { data: selections, error: selectionsError } = await supabase
    .from('grocery_item_selections')
    .select('item_hash, included')
    .eq('weekly_plan_id', planId);
  if (selectionsError) throw new Error(selectionsError.message);

  const overrides = new Map<string, boolean>(
    ((selections ?? []) as { item_hash: string; included: boolean }[]).map((row) => [
      row.item_hash,
      row.included,
    ]),
  );

  return {
    planId,
    items: items.map((item) => ({
      ...item,
      included: overrides.get(item.itemHash) ?? !item.isStaple,
    })),
  };
}

// item_hash_param, not item_hash — an ON CONFLICT target column list in
// the RPC can't be schema-qualified the way a WHERE/VALUES reference
// can, so a same-named parameter there is genuinely ambiguous to the
// planner (same collision ADR-0021 hit with week_key_param; this one
// shipped broken and was caught by CI, not local review, since this
// environment has no Docker to run pgTAP before pushing).
export async function setGroceryItemSelection(
  planId: string,
  itemHash: string,
  included: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_grocery_item_selection', {
    plan_id: planId,
    item_hash_param: itemHash,
    included,
  });
  if (error) throw new Error(error.message);
}

// Restores an item to its computed default (staple -> excluded, else
// included) rather than persisting a row that merely restates the
// default — keeps grocery_item_selections sparse as ADR-0022 actually
// intends, and means a future tuning of the staples list applies
// retroactively to anyone who never overrode that item (Codex review,
// PR #45). Callers decide *when* to call this vs. setGroceryItemSelection
// by comparing the toggled value against the item's own isStaple flag.
export async function clearGroceryItemSelection(planId: string, itemHash: string): Promise<void> {
  const { error } = await supabase.rpc('clear_grocery_item_selection', {
    plan_id: planId,
    item_hash_param: itemHash,
  });
  if (error) throw new Error(error.message);
}
