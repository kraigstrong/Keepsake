import { parseQuantity } from '../../server/units/parseQuantity';
import { parseServings } from '../../server/units/parseServings';
import { trackEvent } from '../observability';
import { supabase } from '../supabase/instance';
import { syncHousehold } from '../sync/syncEngine';
import { STARTER_RECIPES, STARTER_SOURCE_ATTRIBUTION } from './content';

export interface SeedStarterRecipesResult {
  /** False when the household had already seeded, or already had recipes. */
  seeded: boolean;
  recipeCount: number;
}

/**
 * Seeds the bundled starter recipes into the caller's household.
 *
 * Calls the RPC directly rather than looping `saveRecipe()`. That is not
 * a shortcut: `saveRecipe` fires `recipe_saved`, which is the activation
 * signal, and ten of those would drown the metric in events nobody
 * performed. The RPC is also the only thing that can make the ten writes
 * one transaction.
 *
 * `seeded: false` is a success, not a failure — the household already
 * has the recipes (or has its own, which is the reinstall case the RPC
 * refuses). Only a real error throws, and the caller renders it.
 */
export async function seedStarterRecipes(householdId: string): Promise<SeedStarterRecipesResult> {
  const { data, error } = await supabase
    .rpc('seed_starter_recipes', {
      payload: {
        recipes: STARTER_RECIPES.map((recipe) => ({
          title: recipe.title,
          activeTimeMinutes: recipe.activeTimeMinutes,
          totalTimeMinutes: recipe.totalTimeMinutes,
          yieldText: recipe.yieldText,
          // Parsed here, not stored parsed in the repo — the same two
          // calls RecipeEditorScreen.handleSave makes (ADR-0018), so a
          // parser fix reaches the starter recipes for free.
          servingsCount: parseServings(recipe.yieldText),
          permanentNotes: recipe.permanentNotes,
          sourceAttribution: STARTER_SOURCE_ATTRIBUTION,
          tags: recipe.tags,
          // Resolved to ids by the RPC — ids are environment-specific.
          categories: recipe.categories,
          ingredientSections: recipe.ingredientSections.map((section) => ({
            title: section.title,
            lines: section.lines.map(parseQuantity),
          })),
          instructionSections: recipe.instructionSections,
        })),
      },
    })
    .single();

  if (error) throw error;
  const row = data as { seeded: boolean; recipe_count: number };

  // Before the sync, deliberately. The event records that the seed
  // happened, which is true whether or not the local mirror catches up;
  // a sync failure here would otherwise lose the event entirely, and the
  // retry can't re-emit it because the RPC returns seeded: false.
  if (row.seeded) {
    trackEvent('starter_recipes_added', { count: row.recipe_count });
  }

  // Library paints from the local SQLite mirror, so without this the
  // user taps "Add starter recipes" and watches nothing happen.
  await syncHousehold(householdId);

  return { seeded: row.seeded, recipeCount: row.recipe_count };
}
