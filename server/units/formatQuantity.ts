/**
 * Kitchen-friendly rounding (ADR-0018) — never the raw result of a
 * multiplier/conversion, since "3.174603174603175 oz" isn't something
 * anyone would want to measure. Values a cook thinks of in fractions
 * (a null/count line, or tsp/tbsp/cup) round to the nearest common
 * fraction; everything else rounds to a step size that grows with
 * magnitude, so a huge scaled value degrades to a sensible precision
 * instead of a long decimal ("Extreme values"). Every rounding floors
 * at the smallest nonzero step for its bucket — a small scaled-down
 * quantity never displays as "0" ("Small quantity rounding"). The
 * caller is told whether rounding actually changed the value so it can
 * show the "~" approximation indicator.
 */

import type { Unit } from './quantityVocabulary';

export interface FormattedNumber {
  display: string;
  isApproximate: boolean;
}

const FRACTION_STEPS: { value: number; display: string }[] = [
  { value: 0, display: '' },
  { value: 1 / 8, display: '1/8' },
  { value: 1 / 4, display: '1/4' },
  { value: 1 / 3, display: '1/3' },
  { value: 3 / 8, display: '3/8' },
  { value: 1 / 2, display: '1/2' },
  { value: 5 / 8, display: '5/8' },
  { value: 2 / 3, display: '2/3' },
  { value: 3 / 4, display: '3/4' },
  { value: 7 / 8, display: '7/8' },
  { value: 1, display: '' },
];

const EPSILON = 1e-9;

function formatFraction(value: number): FormattedNumber {
  if (value <= 0) {
    return { display: '0', isApproximate: value < -EPSILON };
  }

  const whole = Math.floor(value);
  const frac = value - whole;

  let best = FRACTION_STEPS[0]!;
  let bestDiff = Infinity;
  for (const step of FRACTION_STEPS) {
    const diff = Math.abs(frac - step.value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = step;
    }
  }

  // Floor: a nonzero input never rounds down to a displayed 0.
  if (best.value === 0 && whole === 0) {
    best = FRACTION_STEPS[1]!;
  }

  const roundedValue = best.value === 1 ? whole + 1 : whole + best.value;
  const isApproximate = Math.abs(roundedValue - value) > EPSILON;

  if (best.value === 1) {
    return { display: String(whole + 1), isApproximate };
  }
  if (best.value === 0) {
    return { display: String(whole), isApproximate };
  }
  return {
    display: whole === 0 ? best.display : `${whole} ${best.display}`,
    isApproximate,
  };
}

function stepFor(value: number): number {
  if (value < 10) return 0.25;
  if (value < 50) return 0.5;
  if (value < 200) return 1;
  if (value < 1000) return 5;
  return 25;
}

function formatDecimal(value: number): FormattedNumber {
  if (value <= 0) {
    return { display: '0', isApproximate: value < -EPSILON };
  }

  const step = stepFor(value);
  let rounded = Math.round(value / step) * step;
  if (rounded <= 0) {
    // Floor: a nonzero input never rounds down to a displayed 0.
    rounded = step;
  }
  rounded = Math.round(rounded * 1000) / 1000;

  const isApproximate = Math.abs(rounded - value) > EPSILON;
  return { display: String(rounded), isApproximate };
}

// null (unitless/count) and the small-volume units are the ones a
// cook naturally thinks of in fractions; everything else reads more
// naturally as a decimal.
const FRACTION_FORMATTED_UNITS = new Set<Unit | null>([null, 'tsp', 'tbsp', 'cup']);

export function formatQuantity(value: number, unit: Unit | null): FormattedNumber {
  return FRACTION_FORMATTED_UNITS.has(unit) ? formatFraction(value) : formatDecimal(value);
}
