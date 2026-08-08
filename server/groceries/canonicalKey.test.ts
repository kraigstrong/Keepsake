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
