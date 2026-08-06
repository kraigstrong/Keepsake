/**
 * The closed unit vocabulary (ADR-0018 decision 3) — volume and mass
 * only, split by measurement class, never user-extensible. This is a
 * safety property (an open vocabulary could let an unreviewed or
 * AI-invented unit string carry an unsafe conversion factor), not a
 * taxonomy like categories (ADR-0010) — extending it is a code change,
 * deliberately. Every conversion factor here is to a fixed base unit
 * within its own class (ml for volume, g for mass); there is no factor
 * that crosses classes, so a volume<->mass conversion is structurally
 * unreachable through this table, not just discouraged.
 */

export const VOLUME_UNITS = ['tsp', 'tbsp', 'fl_oz', 'cup', 'pint', 'quart', 'gallon', 'ml', 'l'] as const;
export const MASS_UNITS = ['oz', 'lb', 'g', 'kg'] as const;

export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export type MassUnit = (typeof MASS_UNITS)[number];
export type Unit = VolumeUnit | MassUnit;
export type UnitClass = 'volume' | 'mass';
export type UnitSystem = 'us_customary' | 'metric';

const ALL_UNITS: readonly Unit[] = [...VOLUME_UNITS, ...MASS_UNITS];

export function isUnit(value: string): value is Unit {
  return (ALL_UNITS as readonly string[]).includes(value);
}

export function unitClass(unit: Unit): UnitClass {
  return (VOLUME_UNITS as readonly string[]).includes(unit) ? 'volume' : 'mass';
}

const US_CUSTOMARY_UNITS = new Set<Unit>(['tsp', 'tbsp', 'fl_oz', 'cup', 'pint', 'quart', 'gallon', 'oz', 'lb']);

export function unitSystem(unit: Unit): UnitSystem {
  return US_CUSTOMARY_UNITS.has(unit) ? 'us_customary' : 'metric';
}

// Ascending magnitude order per class+system, used for best-fit unit
// selection when converting across systems (ADR-0018 decision 4).
export const SYSTEM_UNITS: Record<UnitSystem, Record<UnitClass, readonly Unit[]>> = {
  us_customary: {
    volume: ['tsp', 'tbsp', 'fl_oz', 'cup', 'pint', 'quart', 'gallon'],
    mass: ['oz', 'lb'],
  },
  metric: {
    volume: ['ml', 'l'],
    mass: ['g', 'kg'],
  },
};

// Exact conversion factors to each class's base unit (ml for volume, g
// for mass) — standard, reviewed values, not approximations.
const TO_BASE_UNIT: Record<Unit, number> = {
  tsp: 4.92892,
  tbsp: 14.7868,
  fl_oz: 29.5735,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
  ml: 1,
  l: 1000,
  oz: 28.3495,
  lb: 453.592,
  g: 1,
  kg: 1000,
};

/** Throws if `from` and `to` belong to different classes — this is the enforcement point for "never volume<->mass." */
export function convertQuantity(value: number, from: Unit, to: Unit): number {
  if (unitClass(from) !== unitClass(to)) {
    throw new Error(`Cannot convert a ${unitClass(from)} unit ("${from}") to a ${unitClass(to)} unit ("${to}")`);
  }
  return (value * TO_BASE_UNIT[from]) / TO_BASE_UNIT[to];
}

const UNIT_LABELS: Record<Unit, { singular: string; plural: string }> = {
  tsp: { singular: 'tsp', plural: 'tsp' },
  tbsp: { singular: 'tbsp', plural: 'tbsp' },
  fl_oz: { singular: 'fl oz', plural: 'fl oz' },
  cup: { singular: 'cup', plural: 'cups' },
  pint: { singular: 'pint', plural: 'pints' },
  quart: { singular: 'quart', plural: 'quarts' },
  gallon: { singular: 'gallon', plural: 'gallons' },
  ml: { singular: 'ml', plural: 'ml' },
  l: { singular: 'l', plural: 'l' },
  oz: { singular: 'oz', plural: 'oz' },
  lb: { singular: 'lb', plural: 'lb' },
  g: { singular: 'g', plural: 'g' },
  kg: { singular: 'kg', plural: 'kg' },
};

export function unitLabel(unit: Unit, count: number): string {
  const labels = UNIT_LABELS[unit];
  // "1/2 cup", not "1/2 cups" — singular reads naturally for any
  // amount at or below one, not just exactly one.
  return count <= 1 ? labels.singular : labels.plural;
}
