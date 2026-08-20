import { parseQuantity } from './parseQuantity';

describe('parseQuantity — fixture corpus', () => {
  const cases: {
    line: string;
    quantityMin: number | null;
    quantityMax: number | null;
    unit: string | null;
    ingredientText: string | null;
  }[] = [
    // Whole numbers, with and without a recognized unit.
    {
      line: '2 lb baby potatoes, halved',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'baby potatoes, halved',
    },
    { line: '3 eggs', quantityMin: 3, quantityMax: 3, unit: null, ingredientText: 'eggs' },
    {
      line: '1 whole chicken (4 lb)',
      quantityMin: 1,
      quantityMax: 1,
      unit: null,
      ingredientText: 'whole chicken (4 lb)',
    },

    // Ascii fractions.
    {
      line: '1/2 cup sugar',
      quantityMin: 0.5,
      quantityMax: 0.5,
      unit: 'cup',
      ingredientText: 'sugar',
    },
    {
      line: '2 1/2 cups flour',
      quantityMin: 2.5,
      quantityMax: 2.5,
      unit: 'cup',
      ingredientText: 'flour',
    },
    {
      line: '3/4 tsp salt',
      quantityMin: 0.75,
      quantityMax: 0.75,
      unit: 'tsp',
      ingredientText: 'salt',
    },

    // Unicode vulgar fractions.
    {
      line: '½ cup sugar',
      quantityMin: 0.5,
      quantityMax: 0.5,
      unit: 'cup',
      ingredientText: 'sugar',
    },
    {
      line: '1½ cups milk',
      quantityMin: 1.5,
      quantityMax: 1.5,
      unit: 'cup',
      ingredientText: 'milk',
    },
    {
      line: '1 ½ tsp vanilla',
      quantityMin: 1.5,
      quantityMax: 1.5,
      unit: 'tsp',
      ingredientText: 'vanilla',
    },
    {
      line: '¼ tsp cayenne',
      quantityMin: 0.25,
      quantityMax: 0.25,
      unit: 'tsp',
      ingredientText: 'cayenne',
    },

    // Decimals.
    {
      line: '1.5 lb ground beef',
      quantityMin: 1.5,
      quantityMax: 1.5,
      unit: 'lb',
      ingredientText: 'ground beef',
    },

    // Ranges: hyphen, en dash, em dash, "to".
    {
      line: '1-2 lb chicken breasts',
      quantityMin: 1,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'chicken breasts',
    },
    {
      line: '1–2 lb chicken breasts',
      quantityMin: 1,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'chicken breasts',
    },
    {
      line: '1—2 lb chicken breasts',
      quantityMin: 1,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'chicken breasts',
    },
    {
      line: '1/4 to 1/2 tsp cayenne pepper',
      quantityMin: 0.25,
      quantityMax: 0.5,
      unit: 'tsp',
      ingredientText: 'cayenne pepper',
    },
    // A descending range is normalized to ascending order, not left backwards.
    {
      line: '2-1 cups broth',
      quantityMin: 1,
      quantityMax: 2,
      unit: 'cup',
      ingredientText: 'broth',
    },

    // Unit synonym coverage (word forms, abbreviations, plurals).
    {
      line: '2 tablespoons olive oil',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'tbsp',
      ingredientText: 'olive oil',
    },
    {
      line: '2 tbsp olive oil',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'tbsp',
      ingredientText: 'olive oil',
    },
    {
      line: '1 pound carrots',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'lb',
      ingredientText: 'carrots',
    },
    { line: '500 g flour', quantityMin: 500, quantityMax: 500, unit: 'g', ingredientText: 'flour' },
    {
      line: '500 grams flour',
      quantityMin: 500,
      quantityMax: 500,
      unit: 'g',
      ingredientText: 'flour',
    },
    {
      line: '1 kg potatoes',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'kg',
      ingredientText: 'potatoes',
    },
    { line: '250 ml milk', quantityMin: 250, quantityMax: 250, unit: 'ml', ingredientText: 'milk' },
    { line: '1 liter water', quantityMin: 1, quantityMax: 1, unit: 'l', ingredientText: 'water' },
    {
      line: '2 fl oz vodka',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'fl_oz',
      ingredientText: 'vodka',
    },
    {
      line: '1 pint heavy cream',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'pint',
      ingredientText: 'heavy cream',
    },
    {
      line: '1 quart stock',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'quart',
      ingredientText: 'stock',
    },
    {
      line: '1 gallon apple cider',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'gallon',
      ingredientText: 'apple cider',
    },

    // "large"/"liter"-style word-boundary safety: no false single-letter unit match.
    {
      line: '2 large eggs',
      quantityMin: 2,
      quantityMax: 2,
      unit: null,
      ingredientText: 'large eggs',
    },
    {
      line: '2 cloves garlic, minced',
      quantityMin: 2,
      quantityMax: 2,
      unit: null,
      ingredientText: 'cloves garlic, minced',
    },

    // Vague/unparseable amounts — never guessed, always opaque.
    {
      line: 'a pinch of salt',
      quantityMin: null,
      quantityMax: null,
      unit: null,
      ingredientText: null,
    },
    {
      line: 'Salt and pepper to taste',
      quantityMin: null,
      quantityMax: null,
      unit: null,
      ingredientText: null,
    },
    {
      line: 'Fresh basil, for garnish',
      quantityMin: null,
      quantityMax: null,
      unit: null,
      ingredientText: null,
    },

    // A quantity in parentheses/free descriptive text that never resolves to a
    // known unit still parses the leading count and leaves the rest opaque.
    {
      line: '2 (15 oz) cans black beans',
      quantityMin: 2,
      quantityMax: 2,
      unit: null,
      ingredientText: '(15 oz) cans black beans',
    },

    // Alternate-unit annotation (found via live testing, 2026-08-14):
    // stripped rather than parsed, so it can't go stale after scaling
    // ("3 lb / 500g beef" after 3x would be visibly wrong — see
    // stripAlternateUnit's own comment for the developer decision).
    {
      line: '1 lb / 500g beef',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'lb',
      ingredientText: 'beef',
    },
    {
      line: '800g, 28oz can crushed tomato',
      quantityMin: 800,
      quantityMax: 800,
      unit: 'g',
      ingredientText: 'crushed tomato',
    },
    {
      line: '2 cups / 475ml milk',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'cup',
      ingredientText: 'milk',
    },

    // Same alternate-unit annotation, parenthesized instead of slash/
    // comma-separated (found via live testing, 2026-08-14 — this exact
    // phrasing was also why "all-purpose flour" wasn't folding into
    // "flour": the parenthetical sat in front of "all-purpose",
    // blocking canonicalKey's DEFAULT_VARIETY_PREFIXES check before it
    // ever got a chance to match).
    {
      line: '2 1/4 cups (290 g) all-purpose flour',
      quantityMin: 2.25,
      quantityMax: 2.25,
      unit: 'cup',
      ingredientText: 'all-purpose flour',
    },
    {
      line: '1 lb (450 g) butter',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'lb',
      ingredientText: 'butter',
    },

    // Abbreviated unit with a trailing period (found via live testing,
    // 2026-08-19): matchUnit() must consume the period itself, not just
    // the unit text, or it's left behind as a stray leading "." blocking
    // both the parenthetical- and separator-form alternate-unit strips.
    {
      line: '6 oz. (180g) medium cheddar cheese',
      quantityMin: 6,
      quantityMax: 6,
      unit: 'oz',
      ingredientText: 'medium cheddar cheese',
    },
    {
      line: '1 lb. / 500g beef',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'lb',
      ingredientText: 'beef',
    },
    {
      line: '2 tbsp. olive oil',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'tbsp',
      ingredientText: 'olive oil',
    },
  ];

  it.each(cases)('parses "$line"', ({ line, quantityMin, quantityMax, unit, ingredientText }) => {
    const result = parseQuantity(line);
    expect(result.quantityMin).toBe(quantityMin);
    expect(result.quantityMax).toBe(quantityMax);
    expect(result.unit).toBe(unit);
    expect(result.ingredientText).toBe(ingredientText);
  });

  it('always preserves the exact original text as lineText, parsed or not', () => {
    expect(parseQuantity('2 lb baby potatoes, halved').lineText).toBe('2 lb baby potatoes, halved');
    expect(parseQuantity('a pinch of salt').lineText).toBe('a pinch of salt');
    expect(parseQuantity('  2 lb potatoes  ').lineText).toBe('2 lb potatoes');
  });

  it('rejects an extreme quantity as unparsed rather than trusting it', () => {
    const result = parseQuantity('999999 cups flour');
    expect(result.quantityMin).toBeNull();
    expect(result.quantityMax).toBeNull();
    expect(result.unit).toBeNull();
  });

  it('never treats an empty line as parsed', () => {
    const result = parseQuantity('   ');
    expect(result.quantityMin).toBeNull();
    expect(result.unit).toBeNull();
  });

  it('is never fooled into producing an unsafe unit for a temperature-shaped line', () => {
    // Ingredient lines should never contain oven temperatures (that's
    // instruction text, never fed through this parser at all — see
    // ADR-0018), but even if one slipped in, "F"/"°F" is not in the
    // closed unit vocabulary, so it can never be mistaken for a
    // convertible unit.
    const result = parseQuantity('350 F oven-safe dish');
    expect(result.quantityMin).toBe(350);
    expect(result.unit).toBeNull();
    expect(result.ingredientText).toBe('F oven-safe dish');
  });

  describe('alternate-unit stripping never touches a real prep clause', () => {
    // The strip only fires when ingredientText itself starts with the
    // separator (no ingredient name in between) — a genuine comma
    // clause always has a name first, so these are structurally
    // never at risk, but asserted explicitly since it's the one thing
    // this addition must never do.
    it.each([
      ['2 lb baby potatoes, halved', 'baby potatoes, halved'],
      ['2 cups flour, divided', 'flour, divided'],
      ['1 cup olive oil, extra virgin', 'olive oil, extra virgin'],
      ['3 large eggs, at room temperature', 'large eggs, at room temperature'],
    ])('"%s" keeps its full ingredient text', (line, expected) => {
      expect(parseQuantity(line).ingredientText).toBe(expected);
    });

    it('a comma immediately after the unit with no following number is left alone', () => {
      // Unusual phrasing, but exercises the exact boundary the strip
      // checks: separator present, no number after it.
      const result = parseQuantity('2 cups, well chilled flour');
      expect(result.ingredientText).toBe(', well chilled flour');
    });
  });
});
