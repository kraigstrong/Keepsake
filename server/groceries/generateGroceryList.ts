/**
 * Combines a confirmed weekly plan's ingredients into a grouped,
 * categorized grocery list — pure, stateless, no network call (ADR-0022
 * decision 1). The caller supplies already-RLS-authorized data
 * (planning_entries joined to recipes and recipe_ingredients); nothing
 * here is persisted, so this function is safe to re-run on every
 * review-screen load.
 */

import { unitClass, convertQuantity } from '../units/quantityVocabulary.ts';
import { scaleQuantity } from '../units/scaleQuantity.ts';
import { formatIngredientLine } from '../units/formatIngredientLine.ts';
import type { ParsedIngredientLine } from '../units/parseQuantity.ts';
import { canonicalKey } from './canonicalKey.ts';
import { itemHash } from './itemHash.ts';
import { categorize, type GroceryCategory } from './categoryDictionary.ts';
import { isStaple } from './staples.ts';

export interface PlanningEntryForGroceries {
  recipeId: string;
  /** planning_entries.servings — the target serving count for this entry. */
  servings: number;
  /** recipes.servings_count — null when the recipe's yield didn't parse (ADR-0018). */
  recipeServingsCount: number | null;
  ingredientLines: readonly ParsedIngredientLine[];
}

export interface GroceryItem {
  itemHash: string;
  category: GroceryCategory;
  isStaple: boolean;
  /**
   * One display line per safely-summable subgroup (ADR-0022 decision
   * 4). Almost always length 1. Longer than 1 only when the same
   * canonical ingredient appears with incompatible units (e.g. volume
   * vs. mass) or a partly unparsed line — those amounts are never
   * fabricated into one number, they're listed side by side instead.
   */
  amounts: string[];
  sourceRecipeIds: string[];
}

interface ScaledOccurrence extends ParsedIngredientLine {
  recipeId: string;
}

/**
 * Drops everything from the first comma onward, the same structural
 * step canonicalKey() already applies for identity — but here it's
 * applied to what actually renders on the grocery-review row, not just
 * the merge key. Preparation clauses ("flour, divided", "olive oil,
 * extra virgin") are real information on a recipe's own ingredient
 * list (RecipeDetailScreen keeps them, via the same shared
 * formatIngredientLine()) but read as noise on a list meant for a
 * store aisle. Case-preserving, unlike canonicalKey — this is display
 * text, not a lookup key.
 */
function groceryDisplayText(ingredientText: string): string {
  return ingredientText.split(',', 1)[0]!.trim();
}

function multiplierFor(entry: PlanningEntryForGroceries): number {
  if (!entry.recipeServingsCount) {
    return 1;
  }
  return entry.servings / entry.recipeServingsCount;
}

function sumSubgroup(occurrences: ScaledOccurrence[]): string {
  const first = occurrences[0]!;
  if (first.quantityMin === null || occurrences.length === 1) {
    return formatIngredientLine(first);
  }

  const targetUnit = first.unit;
  let summedMin = 0;
  let summedMax = 0;
  for (const occurrence of occurrences) {
    const min = occurrence.quantityMin!;
    const max = occurrence.quantityMax ?? min;
    if (targetUnit === null || occurrence.unit === null) {
      summedMin += min;
      summedMax += max;
    } else {
      summedMin += convertQuantity(min, occurrence.unit, targetUnit);
      summedMax += convertQuantity(max, occurrence.unit, targetUnit);
    }
  }

  return formatIngredientLine({
    lineText: first.lineText,
    quantityMin: summedMin,
    quantityMax: summedMax,
    unit: targetUnit,
    ingredientText: first.ingredientText,
  });
}

export function generateGroceryList(entries: readonly PlanningEntryForGroceries[]): GroceryItem[] {
  const groups = new Map<string, ScaledOccurrence[]>();

  for (const entry of entries) {
    const multiplier = multiplierFor(entry);
    for (const line of entry.ingredientLines) {
      const scaled = scaleQuantity(line, multiplier);
      const identityText = line.ingredientText ?? line.lineText;
      const key = canonicalKey(identityText);
      if (key.length === 0) {
        continue;
      }

      const occurrence: ScaledOccurrence = {
        ...scaled,
        ingredientText:
          scaled.ingredientText === null ? null : groceryDisplayText(scaled.ingredientText),
        recipeId: entry.recipeId,
      };
      const existing = groups.get(key);
      if (existing) {
        existing.push(occurrence);
      } else {
        groups.set(key, [occurrence]);
      }
    }
  }

  const items: GroceryItem[] = [];
  for (const [key, occurrences] of groups) {
    // Only occurrences that share a "safely summable" bucket are ever
    // added together (ADR-0022 decision 4): both unitless, or units in
    // the same class. Anything unparsed (quantityMin null) always gets
    // its own bucket — there is no number to add.
    const subgroups = new Map<string, ScaledOccurrence[]>();
    for (const occurrence of occurrences) {
      let subKey: string;
      if (occurrence.quantityMin === null) {
        // Keyed by the raw text itself, not a running index: two
        // identical unparsed lines (e.g. the same recipe planned
        // twice) collapse into one displayed line; two different
        // unparsed lines stay visibly separate. Either way, nothing is
        // ever summed here — there is no number to add.
        subKey = `unparsed:${occurrence.lineText}`;
      } else if (occurrence.unit === null) {
        subKey = 'unitless';
      } else {
        subKey = `class:${unitClass(occurrence.unit)}`;
      }

      const existing = subgroups.get(subKey);
      if (existing) {
        existing.push(occurrence);
      } else {
        subgroups.set(subKey, [occurrence]);
      }
    }

    const amounts = Array.from(subgroups.values()).map(sumSubgroup);
    const sourceRecipeIds = Array.from(
      new Set(occurrences.map((occurrence) => occurrence.recipeId)),
    );

    items.push({
      itemHash: itemHash(key),
      category: categorize(key),
      isStaple: isStaple(key),
      amounts,
      sourceRecipeIds,
    });
  }

  return items;
}
