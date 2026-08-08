/**
 * Canonical ingredient identity (ADR-0022 decision 3) — deliberately
 * narrow: no dictionary, no synonym table, no fuzzy matching. Two
 * ingredient lines merge only when this function returns the exact
 * same string for both.
 *
 * Normalization steps, in order:
 *  1. Drop everything from the first comma onward — preparation clauses
 *     ("large diced", "at room temperature") that would otherwise make
 *     near-identical ingredients look distinct.
 *  2. Lowercase / trim / collapse whitespace / strip trailing
 *     punctuation.
 *  3. Strip one leading preparation-state word from LEADING_PREP_MODIFIERS
 *     ("melted butter" -> "butter"), then singularize the last word with
 *     a small, fixed suffix rule.
 *
 * Both the suffix rule and LEADING_PREP_MODIFIERS are safe under "a
 * false merge is worse than a missed merge" (execution-plan.md's Phase
 * 13 Validation section) for the same structural reason: each is a
 * small, fixed, reviewed list applied deterministically, so it can only
 * ever make two spellings of the *same* underlying product collide — it
 * has no mechanism to make two different products collide. That's why
 * LEADING_PREP_MODIFIERS deliberately excludes words like "diced",
 * "ground", "chopped", or "cooked": those describe prep states with a
 * real product-identity idiom attached ("diced tomatoes" is a canned
 * good distinct from fresh tomatoes; "ground beef" and "cooked chicken"
 * are different purchases than "beef" or "chicken"), so stripping them
 * would risk exactly the false merge this whole function exists to
 * avoid. The words on the list only ever describe a physical state of
 * an otherwise-identical product (melted vs. solid butter is still
 * butter to buy). Everything else stays an accepted under-merging gap
 * per the ADR, not something this function tries to fix.
 */

// See the module doc above for why this list is this short and this
// specific — extending it is a normal, reviewed code change, but each
// addition needs the same "no product-identity idiom" check.
const LEADING_PREP_MODIFIERS: readonly string[] = [
  'room temperature',
  'melted',
  'softened',
  'chilled',
  'cooled',
  'beaten',
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
