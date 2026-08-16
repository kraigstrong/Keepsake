import { canonicalKey } from './canonicalKey';

describe('canonicalKey', () => {
  describe('must merge (singular/plural pairs of the same ingredient)', () => {
    it.each([
      ['onion', 'onions'],
      ['egg', 'eggs'],
      ['carrot', 'carrots'],
      ['tomato', 'tomatoes'],
      ['potato', 'potatoes'],
      ['peach', 'peaches'],
      ['dish', 'dishes'],
      ['box', 'boxes'],
      ['berry', 'berries'],
      ['strawberry', 'strawberries'],
    ])('"%s" and "%s" produce the same key', (singular, plural) => {
      expect(canonicalKey(singular)).toBe(canonicalKey(plural));
    });

    it('drops a trailing preparation clause after the first comma', () => {
      expect(canonicalKey('onions, diced')).toBe(canonicalKey('onion, chopped'));
    });

    it('is case- and whitespace-insensitive', () => {
      expect(canonicalKey('  Olive   Oil  ')).toBe(canonicalKey('olive oil'));
    });

    it('strips trailing punctuation', () => {
      expect(canonicalKey('Salt.')).toBe(canonicalKey('salt'));
    });

    it.each(['melted butter', 'softened butter', 'chilled butter', 'room temperature butter'])(
      '"%s" merges with "butter"',
      (text) => {
        expect(canonicalKey(text)).toBe(canonicalKey('butter'));
      },
    );

    // Found via live testing, 2026-08-14 — ADR-0022 decision 3's own
    // named escape hatch for exactly this: a small, explicitly reviewed
    // synonym constant (DEFAULT_VARIETY_PREFIXES), not general synonym
    // folding.
    it.each(['all purpose flour', 'All-Purpose Flour', 'all purpose flours'])(
      '"%s" merges with "flour"',
      (text) => {
        expect(canonicalKey(text)).toBe(canonicalKey('flour'));
      },
    );
  });

  describe('must not merge (different ingredients, or a variety distinction)', () => {
    it.each([
      ['yellow onion', 'onion'],
      ['red onion', 'yellow onion'],
      ['chicken breast', 'chicken thigh'],
      ['green onion', 'scallion'],
      ['olive oil', 'vegetable oil'],
      ['baking soda', 'baking powder'],
      ['whole milk', 'skim milk'],
      ['garlic', 'garlic powder'],
      ['sugar', 'brown sugar'],
      // Deliberately NOT on LEADING_PREP_MODIFIERS (module doc): each of
      // these carries a real product-identity idiom, so stripping the
      // modifier would risk a false merge, the one thing this function
      // must never do.
      ['diced tomatoes', 'tomato'],
      ['ground beef', 'beef'],
      ['cooked chicken', 'chicken'],
      ['chopped onion', 'onion'],
      // Codex review, PR #47: "beaten" was on LEADING_PREP_MODIFIERS,
      // but "beaten rice" (flattened rice, poha) is a distinct product,
      // not just rice that's been beaten — the same idiom risk as
      // "ground"/"diced"/"cooked". Removed from the list entirely.
      ['beaten rice', 'rice'],
      // Deliberately NOT on DEFAULT_VARIETY_PREFIXES: each of these is a
      // genuinely distinct flour, not "flour" in a different physical
      // state — folding them would be exactly the false merge this
      // function exists to avoid.
      ['semolina flour', 'flour'],
      ['00 flour', 'flour'],
      ['bread flour', 'flour'],
      ['self-rising flour', 'flour'],
      ['cake flour', 'flour'],
    ])('"%s" and "%s" produce different keys', (a, b) => {
      expect(canonicalKey(a)).not.toBe(canonicalKey(b));
    });
  });

  describe('irregular plurals are an accepted gap, not a crash', () => {
    it('does not merge irregular plurals the suffix rule cannot know', () => {
      // Documented limitation (ADR-0022): under-merging is the accepted
      // failure mode, never a false merge.
      expect(canonicalKey('leaf')).not.toBe(canonicalKey('leaves'));
    });

    it('never throws on short, unusual, or already-singular inputs', () => {
      expect(() => canonicalKey('gas')).not.toThrow();
      expect(() => canonicalKey('molasses')).not.toThrow();
      expect(() => canonicalKey('')).not.toThrow();
      expect(() => canonicalKey('a')).not.toThrow();
    });

    it('is deterministic and self-consistent even for a word its rule mangles', () => {
      expect(canonicalKey('molasses')).toBe(canonicalKey('molasses'));
    });
  });
});
