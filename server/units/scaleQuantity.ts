/**
 * Multiplies a quantity (single value or range) by a scaling factor —
 * a preset chip (1/2x-4x) or an arbitrary-serving-count-derived ratio
 * feed the same multiplier here, so there is one scaling code path,
 * not two (ADR-0018). An unparsed quantity (quantityMin null) is left
 * untouched: nothing to scale, and it must keep displaying as the
 * original lineText regardless of the active multiplier.
 */

// The assumed base servings count wherever a recipe's own servings_count
// never parsed (ADR-0018 — null on purpose rather than guessing at a
// yield that isn't necessarily a servings count at all, e.g. "makes 24
// cookies"). Shared here, not duplicated per call site, so that
// wherever a caller assumes this base to compute a multiplier from a
// stored absolute count, every other caller assumes the exact same
// base back — otherwise the two computations silently disagree (Codex
// review, PR #50: RecipeDetailScreen invented an absolute servings
// count using this base, but generateGroceryList's own multiplierFor
// and CookingModeScreen's plan-default each independently gated on
// recipe.servingsCount being truthy and ignored the stored count
// entirely, so the multiplier never actually reached groceries or
// Cooking Mode). Stopgap only — ADR-0026 replaces the whole
// assumed-base round-trip by storing a multiplier directly instead of
// an absolute count, at which point this constant's only remaining use
// is the servings-count *input* UI, not a value anything needs to
// divide back out.
export const ASSUMED_SERVINGS_WHEN_UNKNOWN = 4;

export interface ScalableQuantity {
  quantityMin: number | null;
  quantityMax: number | null;
}

export function scaleQuantity<T extends ScalableQuantity>(quantity: T, multiplier: number): T {
  if (quantity.quantityMin === null) {
    return quantity;
  }
  return {
    ...quantity,
    quantityMin: quantity.quantityMin * multiplier,
    quantityMax: quantity.quantityMax === null ? null : quantity.quantityMax * multiplier,
  };
}
