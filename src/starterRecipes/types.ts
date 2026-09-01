import type { CategoryGroup, RecipeSection } from '../recipes/api';

/**
 * A category referenced by (group, value) rather than by id.
 *
 * `public.categories` ids are `gen_random_uuid()` defaults seeded by
 * `20260803100000_recipe_schema.sql`, so "Chicken" has a different id
 * locally, on staging and in production. A hardcoded id would pass
 * every local test and silently attach zero categories on staging —
 * the seed RPC resolves these pairs by join instead.
 */
export interface StarterCategoryRef {
  group: CategoryGroup;
  value: string;
}

/**
 * One bundled starter recipe, as authored — before any parsing.
 *
 * Ingredient lines are plain strings and there is no `servingsCount`:
 * both are derived at seed time by the same `parseQuantity` and
 * `parseServings` the editor calls (ADR-0018), so a later parser fix
 * reaches the starter recipes instead of freezing today's parser
 * output into the repo.
 */
export interface StarterRecipe {
  title: string;
  /** A headnote, written to be worth reading; rendered as the recipe's Notes. */
  permanentNotes: string;
  activeTimeMinutes: number;
  totalTimeMinutes: number;
  /** Always present here, but not always readable — see `parseServings`. */
  yieldText: string;
  categories: StarterCategoryRef[];
  /** Lowercase, trimmed, free-form. No new taxonomy values (proposal decision C). */
  tags: string[];
  ingredientSections: RecipeSection[];
  instructionSections: RecipeSection[];
}
