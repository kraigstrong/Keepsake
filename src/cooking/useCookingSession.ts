import { useCallback, useEffect, useRef, useState } from 'react';

import { clearCookingSession, getCookingSession, saveCookingSession } from './checklistState';
import { getDatabase } from '../db/database';
import { useHousehold } from '../household/HouseholdProvider';
import { fetchRecipe, type Recipe } from '../recipes/api';
import { readLocalRecipe } from '../sync/offlineRecipes';

export interface UseCookingSessionResult {
  recipe: Recipe | null;
  isLoading: boolean;
  loadError: boolean;
  checkedIngredientKeys: Set<string>;
  checkedInstructionKeys: Set<string>;
  toggleIngredient: (key: string) => void;
  toggleInstruction: (key: string) => void;
  /** Reset button + a side effect of Done Cooking (prd.md §17). */
  resetChecklist: () => void;
}

/**
 * Loads a recipe the same local-first way RecipeDetailScreen does (OFF-03
 * requires the checklist to work offline, which means the recipe itself
 * has to be readable offline too — there's nothing to check off a recipe
 * you can't see) plus this recipe's device-specific checklist progress
 * (ADR-0024 decision 1).
 *
 * Persistence happens directly inside toggleIngredient/toggleInstruction,
 * not via a useEffect watching the checked-key state: an effect can't
 * reliably tell "the state just changed because the saved session
 * finished loading" apart from "the user just tapped a checkbox" — both
 * produce a new Set reference and re-render the same way. Writing at the
 * point of the actual user action sidesteps that ambiguity entirely.
 */
export function useCookingSession(recipeId: string): UseCookingSessionResult {
  const { household } = useHousehold();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checkedIngredientKeys, setCheckedIngredientKeys] = useState<Set<string>>(new Set());
  const [checkedInstructionKeys, setCheckedInstructionKeys] = useState<Set<string>>(new Set());
  // Always-current mirrors of the two state sets, read (not written) by
  // the toggle handlers below so each one can persist both sets together
  // without depending on the other set's possibly-stale closure value.
  const checkedIngredientKeysRef = useRef(checkedIngredientKeys);
  const checkedInstructionKeysRef = useRef(checkedInstructionKeys);
  useEffect(() => {
    checkedIngredientKeysRef.current = checkedIngredientKeys;
  }, [checkedIngredientKeys]);
  useEffect(() => {
    checkedInstructionKeysRef.current = checkedInstructionKeys;
  }, [checkedInstructionKeys]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let haveData = false;

      if (household) {
        const localRecipe = await readLocalRecipe(recipeId, household.id).catch(() => null);
        if (cancelled) return;
        if (localRecipe) {
          haveData = true;
          setRecipe(localRecipe);
          setIsLoading(false);
        }
      }

      try {
        const freshRecipe = await fetchRecipe(recipeId);
        if (cancelled) return;
        setRecipe(freshRecipe);
        setIsLoading(false);
        setLoadError(false);
      } catch {
        if (cancelled || haveData) return;
        setLoadError(true);
        setIsLoading(false);
      }

      const db = await getDatabase();
      const session = await getCookingSession(db, recipeId);
      if (cancelled) return;
      setCheckedIngredientKeys(new Set(session?.checkedIngredientKeys ?? []));
      setCheckedInstructionKeys(new Set(session?.checkedInstructionKeys ?? []));
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [recipeId, household]);

  const toggleIngredient = useCallback(
    (key: string) => {
      setCheckedIngredientKeys((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        getDatabase().then((db) =>
          saveCookingSession(
            db,
            recipeId,
            Array.from(next),
            Array.from(checkedInstructionKeysRef.current),
          ),
        );
        return next;
      });
    },
    [recipeId],
  );

  const toggleInstruction = useCallback(
    (key: string) => {
      setCheckedInstructionKeys((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        getDatabase().then((db) =>
          saveCookingSession(
            db,
            recipeId,
            Array.from(checkedIngredientKeysRef.current),
            Array.from(next),
          ),
        );
        return next;
      });
    },
    [recipeId],
  );

  const resetChecklist = useCallback(() => {
    setCheckedIngredientKeys(new Set());
    setCheckedInstructionKeys(new Set());
    getDatabase().then((db) => clearCookingSession(db, recipeId));
  }, [recipeId]);

  return {
    recipe,
    isLoading,
    loadError,
    checkedIngredientKeys,
    checkedInstructionKeys,
    toggleIngredient,
    toggleInstruction,
    resetChecklist,
  };
}
