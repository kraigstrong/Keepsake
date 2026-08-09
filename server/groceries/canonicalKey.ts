/**
 * Canonical ingredient identity (ADR-0022 decision 3) — deliberately
 * narrow: no dictionary, no synonym table, no fuzzy matching. Two
 * ingredient lines merge only when this function returns the exact
 * same string for both.
 *
 * Normalization steps, in order:
 *  1. Drop everything from the first comma onward.
 *  2. Lowercase / trim / collapse whitespace / strip trailing punctuation.
 *  3. Strip one leading preparation-state word from LEADING_PREP_MODIFIERS
 *     ("melted butter" -> "butter"), then singularize the last word with
 *     a small, fixed suffix rule.
 *
 * See the ADR for why this stays this narrow. LEADING_PREP_MODIFIERS
 * carries the same constraint one level down: each entry must describe
 * only a physical state of an otherwise-identical product, never a
 * word that's also its own distinct product name ("ground beef",
 * "diced tomatoes" — real idioms, not just "beef"/"tomatoes" in a
 * different state) — that's what would turn this into a false merge.
 */

const LEADING_PREP_MODIFIERS: readonly string[] = [
  'room temperature',
  'melted',
  'softened',
  'chilled',
  'cooled',
  'whisked',
  'warmed',
];

function stripLeadingModifier(phrase: string): string {
  for (const modifier of LEADING_PREP_MODIFIERS) {
    if (phrase.startsWith(`${modifier} `)) {
      return phrase.slice(modifier.length + 1);
    }
  }
  return phrase;
}

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

  return singularizeLastWord(stripLeadingModifier(normalized));
}
