/**
 * Parses a free-text ingredient line ("2 lb baby potatoes, halved")
 * into structured quantity/unit fields, per ADR-0018. A line that
 * can't be confidently read is never guessed at — every field comes
 * back null and the line stays opaque, displayed as lineText verbatim
 * everywhere downstream. This is the sole authority for what counts as
 * "parsed": both the client (manual entry) and the import-recipe Edge
 * Function (AI-extracted lines) call this before building a
 * save_recipe payload, so there is exactly one parsing implementation
 * to trust, not two.
 *
 * Only ever called against recipe_ingredients.line_text, never
 * instruction text — an oven temperature mentioned in a step is
 * structurally never seen by this parser (ADR-0018, "Temperature
 * preservation").
 */

import { isUnit, type Unit } from './quantityVocabulary.ts';

export interface ParsedIngredientLine {
  lineText: string;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: Unit | null;
  ingredientText: string | null;
}

// A parsed quantity outside this bound is treated as a failed parse
// rather than trusted (ADR-0018, "Extreme values") — almost certainly
// a mis-match, not a real recipe amount.
const MAX_SANE_QUANTITY = 10_000;

const VULGAR_FRACTIONS: Record<string, number> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅐': 1 / 7,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
  '⅑': 1 / 9,
  '⅒': 1 / 10,
};
const VULGAR_FRACTION_CHARS = Object.keys(VULGAR_FRACTIONS).join('');

// Tried in order against the start of the (already-trimmed) remaining
// text; the first that matches wins. Each has exactly one capture
// group shape consumed by parseNumberValue below.
const NUMBER_PATTERNS: RegExp[] = [
  // mixed ascii fraction: "2 1/2", and the "N and X/Y" phrasing some
  // recipe blogs use instead of plain whitespace (found via live
  // testing, 2026-08-19: sallysbakingaddiction.com's "1 and 3/4 cups").
  /^(\d+)\s+(?:and\s+)?(\d+)\/(\d+)/i,
  /^(\d+)\/(\d+)/, // simple ascii fraction: "1/2"
  new RegExp(`^(\\d+)\\s*(?:and\\s+)?([${VULGAR_FRACTION_CHARS}])`, 'i'), // mixed unicode: "1½" / "1 ½" / "1 and ½"
  new RegExp(`^([${VULGAR_FRACTION_CHARS}])`), // bare unicode: "½"
  /^(\d+(?:\.\d+)?)/, // integer or decimal: "2" / "2.5"
];

interface NumberMatch {
  value: number;
  matchedLength: number;
}

function matchNumber(text: string): NumberMatch | null {
  for (const pattern of NUMBER_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const [full, a, b, c] = match;
    let value: number;
    if (c !== undefined) {
      // mixed ascii fraction: whole a, numerator b, denominator c
      value = Number(a) + Number(b) / Number(c);
    } else if (b !== undefined && VULGAR_FRACTIONS[b] === undefined) {
      // simple ascii fraction: numerator a, denominator b
      value = Number(a) / Number(b);
    } else if (b !== undefined) {
      // mixed unicode: whole a, fraction char b
      value = Number(a) + VULGAR_FRACTIONS[b]!;
    } else if (VULGAR_FRACTIONS[a!] !== undefined) {
      value = VULGAR_FRACTIONS[a!]!;
    } else {
      value = Number(a);
    }

    if (!Number.isFinite(value)) return null;
    return { value, matchedLength: full.length };
  }
  return null;
}

const RANGE_SEPARATOR = /^\s*(?:-|–|—|to)\s*/i;

const UNIT_SYNONYMS: Record<string, Unit> = {
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  'fl oz': 'fl_oz',
  floz: 'fl_oz',
  'fluid ounce': 'fl_oz',
  'fluid ounces': 'fl_oz',
  cup: 'cup',
  cups: 'cup',
  pint: 'pint',
  pints: 'pint',
  pt: 'pint',
  quart: 'quart',
  quarts: 'quart',
  qt: 'quart',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
};

// Longest synonym first so "fl oz" matches before a hypothetical
// shorter prefix would, then word-bounded so "large" never matches "l".
const UNIT_PATTERN = new RegExp(
  `^(${Object.keys(UNIT_SYNONYMS)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'i',
);

function matchUnit(text: string): { unit: Unit; matchedLength: number } | null {
  const match = UNIT_PATTERN.exec(text);
  if (!match) return null;
  const key = match[1]!.toLowerCase();
  const synonym = UNIT_SYNONYMS[key];
  if (!synonym || !isUnit(synonym)) return null;
  // Abbreviated units ("oz.", "lb.") often carry a trailing period; consume
  // it here so it isn't left as a stray leading "." on whatever follows
  // (docs/roadmap.md's Not-yet-triaged backlog has the incident history).
  let matchedLength = match[0].length;
  if (text[matchedLength] === '.') {
    matchedLength += 1;
  }
  return { unit: synonym, matchedLength };
}

function unparsed(lineText: string): ParsedIngredientLine {
  return { lineText, quantityMin: null, quantityMax: null, unit: null, ingredientText: null };
}

// Found via live testing, 2026-08-14: "1 lb / 500g beef" or "800g, 28oz
// can crushed tomato" write a second, alternate-unit quantity right
// next to the first — common recipe-blog style (US customary + metric,
// or a can size alongside a weight). Only the leading quantity is ever
// structured (ADR-0018 — a line has exactly one quantity/unit), so the
// second one sits inertly inside ingredientText and doesn't scale with
// it: "3 lb / 500g beef" after 3x is visibly wrong, not just
// unhelpful. Developer decision, 2026-08-14: strip it rather than
// parse and scale both — same "don't show a number this code can't
// vouch for" posture ADR-0018 already takes elsewhere, and the user
// already has Original/Preferred unit display (UNIT-02) for seeing a
// converted amount that's actually kept in sync with scaling.
//
// Only strips when a recognized unit (matchUnit, the same fixed
// vocabulary as the primary quantity — no fuzzy matching) immediately
// follows a number immediately following a leading "/" or ",". A
// genuine prep clause ("flour, divided") never matches: there's always
// an ingredient name between the unit and that kind of comma, so
// ingredientText never starts with the separator in the first place.
const ALTERNATE_UNIT_SEPARATOR = /^\s*[/,]\s*/;
const CONTAINER_WORDS = ['can', 'jar', 'package', 'pkg', 'bag', 'box', 'container'];
const CONTAINER_PATTERN = new RegExp(`^\\s*(?:${CONTAINER_WORDS.join('|')})\\b\\.?\\s*`, 'i');
const OPEN_PAREN = /^\(\s*/;
const CLOSE_PAREN = /^\s*\)\s*/;

// Found via live testing, 2026-08-14: "2 1/4 cups (290 g) all-purpose
// flour" writes the same alternate-unit annotation the slash/comma
// forms above handle, just parenthesized. This one needs an extra
// guard the others don't: a leading parenthetical only means "another
// unit for this same quantity" when a primary unit was already
// captured. "2 (15 oz) cans black beans" has no primary unit (nothing
// before "cans" matches the vocabulary) — there the parenthetical is
// each can's own size, composed with the count, not a redundant
// restatement of it, and must never be stripped. hasPrimaryUnit is
// exactly that distinction, passed in from the one call site that
// already knows whether matchUnit succeeded.
function stripParentheticalAlternateUnit(text: string, hasPrimaryUnit: boolean): string {
  if (!hasPrimaryUnit) return text;
  const openMatch = OPEN_PAREN.exec(text);
  if (!openMatch) return text;

  const inside = text.slice(openMatch[0].length);
  const number = matchNumber(inside);
  if (!number) return text;

  const afterNumber = inside.slice(number.matchedLength).replace(/^\s+/, '');
  const unit = matchUnit(afterNumber);
  if (!unit) return text;

  const afterUnit = afterNumber.slice(unit.matchedLength);
  const closeMatch = CLOSE_PAREN.exec(afterUnit);
  if (!closeMatch) return text; // no closing paren right after the unit — not confidently this pattern

  return afterUnit.slice(closeMatch[0].length);
}

function stripAlternateUnit(text: string, hasPrimaryUnit: boolean): string {
  const separatorMatch = ALTERNATE_UNIT_SEPARATOR.exec(text);
  if (!separatorMatch) return stripParentheticalAlternateUnit(text, hasPrimaryUnit);

  const afterSeparator = text.slice(separatorMatch[0].length);
  const number = matchNumber(afterSeparator);
  if (!number) return text; // no number right after the separator — not this pattern, e.g. "flour, divided"

  const afterNumber = afterSeparator.slice(number.matchedLength).replace(/^\s+/, '');
  const unit = matchUnit(afterNumber);
  if (!unit) return text; // a number but no recognized unit — not confidently an alternate-unit annotation

  let afterUnit = afterNumber.slice(unit.matchedLength).replace(/^\s+/, '');
  const containerMatch = CONTAINER_PATTERN.exec(afterUnit);
  if (containerMatch) {
    afterUnit = afterUnit.slice(containerMatch[0].length);
  }
  return afterUnit;
}

export function parseQuantity(rawLineText: string): ParsedIngredientLine {
  const lineText = rawLineText.trim();
  if (lineText.length === 0) {
    return unparsed(rawLineText);
  }

  const firstNumber = matchNumber(lineText);
  if (!firstNumber) {
    return unparsed(lineText);
  }

  let quantityMin = firstNumber.value;
  let quantityMax = firstNumber.value;
  let rest = lineText.slice(firstNumber.matchedLength);

  const rangeMatch = RANGE_SEPARATOR.exec(rest);
  if (rangeMatch) {
    const afterSeparator = rest.slice(rangeMatch[0].length);
    const secondNumber = matchNumber(afterSeparator);
    if (secondNumber) {
      quantityMax = secondNumber.value;
      rest = afterSeparator.slice(secondNumber.matchedLength);
    }
  }

  if (quantityMin > MAX_SANE_QUANTITY || quantityMax > MAX_SANE_QUANTITY) {
    return unparsed(lineText);
  }
  if (quantityMin > quantityMax) {
    [quantityMin, quantityMax] = [quantityMax, quantityMin];
  }

  rest = rest.replace(/^\s+/, '');

  const unitMatch = matchUnit(rest);
  const unit = unitMatch ? unitMatch.unit : null;
  const afterUnit = unitMatch ? rest.slice(unitMatch.matchedLength) : rest;

  const ingredientText = stripAlternateUnit(afterUnit.trim(), unit !== null).trim();

  return {
    lineText,
    quantityMin,
    quantityMax,
    unit,
    ingredientText: ingredientText.length > 0 ? ingredientText : null,
  };
}
