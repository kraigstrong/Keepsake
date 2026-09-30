import type { CategoryGroup, RecipeSection } from '../recipes/api';

/**
 * A category referenced by (group, value) rather than by id, because
 * category ids differ per environment. Reasoning:
 * `docs/proposals/starter-recipes.md` §2. The seed RPC resolves the pair.
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
  /**
   * Names the shared image at `starters/<imageKey>.jpg` (ADR-0029) — a
   * key, never a path. The seed RPC validates it and builds the path
   * itself, so nothing here can point `hero_image_path` at another
   * household's Storage.
   *
   * Null, or a key whose object has not been uploaded yet, renders
   * `ImagePlaceholder` like any other recipe without a photo. Replacing
   * an image means a new key, not an overwrite — devices cache by path
   * (`docs/deploying-starter-images.md`).
   */
  imageKey: string | null;
  ingredientSections: RecipeSection[];
  instructionSections: RecipeSection[];
}
