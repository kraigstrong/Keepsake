import type { IngredientSection, RecipeSection } from '../recipes/api';

// Same flattened shape as recipes/api.ts's Recipe, plus the two columns
// only sync itself needs (household_id for local scoping, updated_at as
// half of the sync cursor) — ADR-0013.
export interface SyncedRecipe {
  id: string;
  householdId: string;
  version: number;
  title: string;
  heroImagePath: string | null;
  originalPhotoPath: string | null;
  activeTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  yieldText: string | null;
  servingsCount: number | null;
  permanentNotes: string | null;
  sourceUrl: string | null;
  sourceAttribution: string | null;
  tags: string[];
  categoryIds: string[];
  ingredientSections: IngredientSection[];
  instructionSections: RecipeSection[];
  createdAt: string;
  updatedAt: string;
}

export interface DeletedRecipeTombstone {
  id: string;
  householdId: string;
  deletedAt: string;
}

// (updated_at, id) / (deleted_at, id) tuples, not bare timestamps — a
// plain timestamp cursor can miss or double-fetch rows changed in the
// same instant (ADR-0013).
export interface SyncCursor {
  recipesCursorUpdatedAt: string | null;
  recipesCursorId: string | null;
  deletesCursorDeletedAt: string | null;
  deletesCursorId: string | null;
}

export const EMPTY_CURSOR: SyncCursor = {
  recipesCursorUpdatedAt: null,
  recipesCursorId: null,
  deletesCursorDeletedAt: null,
  deletesCursorId: null,
};

export const SYNC_PAGE_SIZE = 200;
