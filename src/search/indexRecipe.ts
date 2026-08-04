import type { RecipeSection } from '../recipes/api';

/**
 * Pure flattening of a recipe's already-fetched fields into the plain-text
 * columns recipe_fts/recipe_trigram index — no SQLite dependency, fully
 * unit testable. The actual INSERT/DELETE calls live in sync/local.ts.
 *
 * Column set matches prd.md §13's search scope exactly: title,
 * ingredients, notes, source attribution, source, categories, tags —
 * instructions are deliberately not indexed (not in the PRD's list).
 */
export interface IndexableRecipe {
  id: string;
  title: string;
  permanentNotes: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: RecipeSection[];
}

export interface FlattenedSearchRow {
  recipeId: string;
  title: string;
  ingredients: string;
  notes: string;
  sourceAttribution: string;
  sourceUrl: string;
  categories: string;
  tags: string;
}

function flattenSections(sections: RecipeSection[]): string {
  return sections
    .flatMap((section) => [section.title, ...section.lines])
    .filter((line): line is string => Boolean(line))
    .join(' ');
}

export function flattenRecipeForSearch(
  recipe: IndexableRecipe,
  categoryLabelsById: ReadonlyMap<string, string>,
): FlattenedSearchRow {
  return {
    recipeId: recipe.id,
    title: recipe.title,
    ingredients: flattenSections(recipe.ingredientSections),
    notes: recipe.permanentNotes ?? '',
    sourceAttribution: recipe.sourceAttribution ?? '',
    sourceUrl: recipe.sourceUrl ?? '',
    categories: recipe.categoryIds
      .map((id) => categoryLabelsById.get(id))
      .filter((label): label is string => Boolean(label))
      .join(' '),
    tags: recipe.tags.join(' '),
  };
}
