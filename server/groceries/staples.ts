/**
 * Static, curated list of common pantry staples (ADR-0022 decision 5)
 * — no AI call, no per-household settings UI (no such build-scope
 * bullet exists for this phase, and PRD §19's "no editing" reads as
 * the same minimalism extended here). A staple match sets a review
 * row's *default* included state to false; nothing else changes —
 * there is no separate "staples" concept anywhere else in the app.
 *
 * Entries are written as natural words/phrases and normalized through
 * canonicalKey() at module load, so this list never has to be kept in
 * sync with canonicalKey's own singularization rules by hand.
 */

import { canonicalKey } from './canonicalKey';

const RAW_STAPLES: readonly string[] = [
  'salt',
  'black pepper',
  'pepper',
  'sugar',
  'brown sugar',
  'flour',
  'all-purpose flour',
  'olive oil',
  'vegetable oil',
  'canola oil',
  'cooking oil',
  'cooking spray',
  'butter',
  'water',
  'baking soda',
  'baking powder',
  'vanilla extract',
  'garlic powder',
  'onion powder',
  'cornstarch',
  'soy sauce',
  'ketchup',
  'mustard',
  'mayonnaise',
  'white vinegar',
  'apple cider vinegar',
  'honey',
  'ground cinnamon',
  'paprika',
  'cumin',
  'oregano',
  'red pepper flakes',
  'bay leaves',
  'worcestershire sauce',
];

export const STAPLE_CANONICAL_KEYS: ReadonlySet<string> = new Set(
  RAW_STAPLES.map((staple) => canonicalKey(staple)),
);

export function isStaple(itemCanonicalKey: string): boolean {
  return STAPLE_CANONICAL_KEYS.has(itemCanonicalKey);
}
