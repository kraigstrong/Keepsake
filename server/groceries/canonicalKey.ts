/**
 * Canonical ingredient identity (ADR-0022 decision 3) — deliberately
 * narrow: no dictionary, no fuzzy matching, and only the one small,
 * explicitly reviewed synonym constant that ADR itself calls out as
 * the intended extension path (DEFAULT_VARIETY_PREFIXES below). Two
 * ingredient lines merge only when this function returns the exact
 * same string for both.
 *
 * Normalization steps, in order:
 *  1. Drop everything from the first comma onward.
 *  2. Lowercase / trim / collapse whitespace / strip trailing punctuation.
 *  3. Strip one leading preparation-state word from LEADING_PREP_MODIFIERS
 *     ("melted butter" -> "butter") and/or one leading default-variety
 *     prefix from DEFAULT_VARIETY_PREFIXES ("all purpose flour" ->
 *     "flour"), then singularize the last word with a small, fixed
 *     suffix rule.
 *
 * See the ADR for why this stays this narrow. Both lists below carry
 * the same constraint one level down: each entry must describe only a
 * physical state or the unqualified-default variety of an otherwise-
 * identical product, never a word that's also its own distinct product
 * name ("ground beef", "diced tomatoes" — real idioms, not just
 * "beef"/"tomatoes" in a different state; "semolina flour", "00 flour"
 * — real distinct products, not "flour" in a different state) — that's
 * what would turn this into a false merge.
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

// ADR-0022 decision 3's own escape hatch: "no stemming beyond this, and
// no cross-recipe synonym folding... If the fixture suite later shows
// this misses too much in practice, the fix is a small, explicitly
// reviewed synonym constant... not an automated inference." Developer
// decision, 2026-08-14 (live testing): "all purpose flour" folds to
// "flour" — most recipes that just say "flour" mean this, and treating
// them as different shopping items is the actual false-negative in
// practice. A genuinely distinct flour (semolina, 00, bread, cake,
// self-rising) is deliberately never on this list and stays its own
// item — same false-merge caution LEADING_PREP_MODIFIERS' own comment
// explains, applied to a different kind of leading word: not a prep
// state, the *default* variety of an ingredient some recipes spell out
// and others simply imply.
const DEFAULT_VARIETY_PREFIXES: readonly string[] = ['all purpose', 'all-purpose'];

// Exported (not just used internally) for generateGroceryList.ts's own
// display text (found via live testing, 2026-08-14): a grocery item
// that correctly merged "softened butter" and "butter" via this same
// list still displayed as "softened butter" — merging and display were
// never wired to share this stripping, only the merge key was. Case-
// insensitive match, case-preserving return: canonicalKey() below
// already lowercases before calling this, so it's a no-op change there;
// generateGroceryList.ts calls it directly on real-cased display text,
// where preserving casing matters. Strips at most one prep modifier and
// one variety prefix — never both from the same phrase in practice
// (nothing on either list plausibly precedes the other), but checking
// both keeps this correct if that ever changes.
export function stripLeadingModifier(phrase: string): string {
  let result = phrase;
  for (const modifier of LEADING_PREP_MODIFIERS) {
    const lower = result.toLowerCase();
    if (lower.startsWith(`${modifier} `)) {
      result = result.slice(modifier.length + 1);
      break;
    }
  }
  for (const prefix of DEFAULT_VARIETY_PREFIXES) {
    const lower = result.toLowerCase();
    if (lower.startsWith(`${prefix} `)) {
      result = result.slice(prefix.length + 1);
      break;
    }
  }
  return result;
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
