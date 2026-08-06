/**
 * Parses recipes.yield_text into a structured serving count, per
 * ADR-0018 and execution-plan.md's Phase 11 objective. Only a clear
 * single serving count parses ("Serves 4" -> 4); a range ("Serves
 * 4-6") or a non-serving yield ("makes one 9x13 pan") is left null on
 * purpose, not guessed at — those recipes get the 1/2x-4x presets
 * only, no arbitrary-serving-count stepper. yield_text itself is
 * untouched either way; this never modifies it, only reads it.
 */

const MAX_SANE_SERVINGS = 1000;

// "Serves 4", "Serves 4 people", "4 servings", "Serves: 4" — but not a
// range ("Serves 4-6") or a non-serving yield ("makes one 9x13 pan"),
// both of which fall through to no match on purpose.
const SERVES_PATTERN = /\bserves?\s*:?\s*(\d+)\b(?!\s*(?:-|–|—|to)\s*\d)/i;
const SERVINGS_SUFFIX_PATTERN = /\b(\d+)\s*servings?\b(?!\s*(?:-|–|—|to)\s*\d)/i;

export function parseServings(yieldText: string | null): number | null {
  if (!yieldText) return null;

  const match = SERVES_PATTERN.exec(yieldText) ?? SERVINGS_SUFFIX_PATTERN.exec(yieldText);
  if (!match) return null;

  const count = Number(match[1]);
  if (!Number.isFinite(count) || count <= 0 || count > MAX_SANE_SERVINGS) {
    return null;
  }
  return count;
}
