/**
 * Pure category-name matching — no Node/Deno-specific APIs, so this file
 * runs unchanged in the Deno Edge Function and stays Jest-testable in
 * Node, the same split as normalizeUrl.ts and its siblings.
 *
 * Extraction now gives the model the real category vocabulary (see
 * server/ai/extractRecipe.ts's buildExtractionSystemPrompt), so this is a
 * closed-set lookup rather than a coincidence-reliant guess (ORG-04/AI-06,
 * flagged at Phase 8 exit review — docs/history/phase-08-url-import.md).
 * Case-insensitive matching stays as a safety net against the model
 * echoing a value with different casing; an unmapped name is dropped
 * rather than passed through, since save_recipe requires every
 * categoryId to reference a real row (Phase 4's atomicity test covers
 * this failure mode).
 */
export interface CategoryRow {
  id: string;
  value: string;
}

export function mapCategoryNamesToIds(names: string[], categories: CategoryRow[]): string[] {
  const idByLowerValue = new Map(categories.map((c) => [c.value.toLowerCase(), c.id]));
  return names
    .map((name) => idByLowerValue.get(name.toLowerCase()))
    .filter((id): id is string => id !== undefined);
}
