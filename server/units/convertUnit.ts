/**
 * Converts a quantity to the user's preferred unit system for display
 * (the "Preferred" half of the Original/Preferred toggle, ADR-0018
 * decision 4). A recipe already stored in the target system is left
 * exactly as-is — no re-bucketing an already-matching unit (a metric
 * recipe stays in ml even under Metric preferred, per the ADR). Only a
 * genuine cross-system conversion picks a different unit, choosing the
 * best-fitting one in the target system (the largest unit that still
 * reads as >= 1, falling back to the smallest) so the result isn't an
 * awkward "1500 ml" or "0.125 cup".
 *
 * A null unit (unitless/count line, e.g. "3 eggs") is never converted
 * — there is nothing to convert, only to scale.
 */

import {
  SYSTEM_UNITS,
  convertQuantity,
  unitClass,
  unitSystem,
  type Unit,
  type UnitSystem,
} from './quantityVocabulary';

export interface ConvertibleQuantity {
  quantityMin: number | null;
  quantityMax: number | null;
  unit: Unit | null;
}

function bestFitUnit(baseValue: number, candidates: readonly Unit[], from: Unit): Unit {
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i]!;
    if (convertQuantity(baseValue, from, candidate) >= 1) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export function convertToSystem<T extends ConvertibleQuantity>(
  quantity: T,
  targetSystem: UnitSystem,
): T {
  if (quantity.unit === null || quantity.quantityMin === null) {
    return quantity;
  }
  if (unitSystem(quantity.unit) === targetSystem) {
    return quantity;
  }

  const candidates = SYSTEM_UNITS[targetSystem][unitClass(quantity.unit)];
  const targetUnit = bestFitUnit(quantity.quantityMin, candidates, quantity.unit);

  return {
    ...quantity,
    quantityMin: convertQuantity(quantity.quantityMin, quantity.unit, targetUnit),
    quantityMax:
      quantity.quantityMax === null
        ? null
        : convertQuantity(quantity.quantityMax, quantity.unit, targetUnit),
    unit: targetUnit,
  };
}
