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

interface FetchedIngredientLine {
  line_text: string;
  quantity_min: number | null;
  quantity_max: number | null;
  unit: string | null;
  ingredient_text: string | null;
}
interface FetchedPlanningEntryRow {
  recipe_id: string;
  servings: number;
  recipe: {
    servings_count: number | null;
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
 */
export async function fetchGroceryReview(planId: string): Promise<GroceryReviewList> {
  const { data: entries, error: entriesError } = await supabase
    .from('planning_entries')
    .select(
      `recipe_id, servings,
       recipe:recipes (
         servings_count,
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
    servings: row.servings,
    recipeServingsCount: row.recipe?.servings_count ?? null,
    ingredientLines: (row.recipe?.recipe_ingredient_sections ?? []).flatMap((section) =>
      section.recipe_ingredients.map(toParsedLine),
    ),
  }));

  const items = generateGroceryList(planningEntries);

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

export async function setGroceryItemSelection(
  planId: string,
  itemHash: string,
  included: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_grocery_item_selection', {
    plan_id: planId,
    item_hash: itemHash,
    included,
  });
  if (error) throw new Error(error.message);
}
