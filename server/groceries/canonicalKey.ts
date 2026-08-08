/**
 * Canonical ingredient identity (ADR-0022 decision 3) — deliberately
 * narrow: no dictionary, no synonym table, no fuzzy matching. Two
 * ingredient lines merge only when this function returns the exact
 * same string for both.
 *
 * Two normalization steps, in order:
 *  1. Drop everything from the first comma onward — preparation clauses
 *     ("large diced", "at room temperature") that would otherwise make
 *     near-identical ingredients look distinct.
 *  2. Lowercase / trim / collapse whitespace / strip trailing
 *     punctuation, then singularize the last word with a small, fixed
 *     suffix rule.
 *
 * The suffix rule is safe under "a false merge is worse than a missed
 * merge" (execution-plan.md's Phase 13 Validation section) for a
 * structural reason, not just caution: it is applied independently to
 * each string, so it can only ever make two spellings of the *same*
 * underlying word collide (a true singular/plural pair) — it has no
 * mechanism to make two different ingredients collide. Its only failure
 * mode is under-merging (irregular plurals it doesn't know, adjectives
 * left in front so "yellow onion" never merges with "onion") — an
 * accepted gap per the ADR, not something this function tries to fix.
 */

function singularizeWord(word: string): string {
  if (word.length <= 3) {
    return word;
  }
  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith('oes')) {
    return word.slice(0, -2);
  }
  if (/(ches|shes|xes|ses)$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

function singularizeLastWord(phrase: string): string {
  const words = phrase.split(' ');
  const lastIndex = words.length - 1;
  words[lastIndex] = singularizeWord(words[lastIndex]!);
  return words.join(' ');
}

export function canonicalKey(text: string): string {
  const beforeFirstComma = text.split(',', 1)[0]!;
  const normalized = beforeFirstComma
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.;:!?]+$/, '')
    .trim();

  if (normalized.length === 0) {
    return normalized;
  }

  return singularizeLastWord(normalized);
}
