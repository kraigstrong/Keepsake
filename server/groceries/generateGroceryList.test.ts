import { generateGroceryList, type PlanningEntryForGroceries } from './generateGroceryList';
import { itemHash } from './itemHash';
import { canonicalKey } from './canonicalKey';

function line(
  overrides: Partial<{
    lineText: string;
    quantityMin: number | null;
    quantityMax: number | null;
    unit: PlanningEntryForGroceries['ingredientLines'][number]['unit'];
    ingredientText: string | null;
  }>,
) {
  return {
    lineText: overrides.lineText ?? '',
    quantityMin: overrides.quantityMin ?? null,
    quantityMax: overrides.quantityMax ?? overrides.quantityMin ?? null,
    unit: overrides.unit ?? null,
    ingredientText: overrides.ingredientText ?? null,
  };
}

function entry(
  recipeId: string,
  multiplier: number,
  ingredientLines: PlanningEntryForGroceries['ingredientLines'],
): PlanningEntryForGroceries {
  return { recipeId, multiplier, ingredientLines };
}

function findItem(items: ReturnType<typeof generateGroceryList>, text: string) {
  const key = canonicalKey(text);
  return items.find((item) => item.itemHash === itemHash(key));
}

describe('generateGroceryList', () => {
  describe('must merge', () => {
    it('sums the same unitless ingredient across two recipes', () => {
      const items = generateGroceryList([
        entry('r1', 1, [line({ lineText: '2 onions', quantityMin: 2, ingredientText: 'onions' })]),
        entry('r2', 1, [line({ lineText: '1 onion', quantityMin: 1, ingredientText: 'onion' })]),
      ]);

      const onions = findItem(items, 'onion');
      expect(onions).toBeDefined();
      expect(onions!.amounts).toEqual(['3 onions']);
      expect(onions!.sourceRecipeIds.sort()).toEqual(['r1', 'r2']);
    });

    it('sums quantities across compatible units in the same class (volume)', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '1 cup milk', quantityMin: 1, unit: 'cup', ingredientText: 'milk' }),
        ]),
        entry('r2', 1, [
          line({ lineText: '1 pint milk', quantityMin: 1, unit: 'pint', ingredientText: 'milk' }),
        ]),
      ]);

      const milk = findItem(items, 'milk');
      expect(milk).toBeDefined();
      expect(milk!.amounts).toHaveLength(1);
      // 1 cup + 1 pint (2 cups) = 3 cups.
      expect(milk!.amounts[0]).toBe('3 cups milk');
    });

    it('merges duplicate identical unparsed lines into a single displayed line', () => {
      const items = generateGroceryList([
        entry('r1', 1, [line({ lineText: 'Salt and pepper to taste' })]),
        entry('r2', 1, [line({ lineText: 'Salt and pepper to taste' })]),
      ]);

      const item = findItem(items, 'Salt and pepper to taste');
      expect(item).toBeDefined();
      expect(item!.amounts).toEqual(['Salt and pepper to taste']);
    });
  });

  describe('must not merge', () => {
    it('keeps a variety distinction separate ("yellow onion" vs "onion")', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '1 yellow onion', quantityMin: 1, ingredientText: 'yellow onion' }),
        ]),
        entry('r2', 1, [line({ lineText: '1 onion', quantityMin: 1, ingredientText: 'onion' })]),
      ]);

      expect(findItem(items, 'yellow onion')).toBeDefined();
      expect(findItem(items, 'onion')).toBeDefined();
      expect(findItem(items, 'yellow onion')!.itemHash).not.toBe(
        findItem(items, 'onion')!.itemHash,
      );
    });

    it('never sums across incompatible unit classes (volume vs. mass) for the same name', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '2 cups flour', quantityMin: 2, unit: 'cup', ingredientText: 'flour' }),
        ]),
        entry('r2', 1, [
          line({ lineText: '1 lb flour', quantityMin: 1, unit: 'lb', ingredientText: 'flour' }),
        ]),
      ]);

      const flour = findItem(items, 'flour');
      expect(flour).toBeDefined();
      // Same canonical item, but two distinct amounts — never a
      // fabricated shared total across volume and mass.
      expect(flour!.amounts).toHaveLength(2);
      expect(flour!.amounts).toEqual(expect.arrayContaining([expect.stringContaining('flour')]));
    });

    it('never sums a parsed quantity with an unparsed line for the same ingredient', () => {
      const items = generateGroceryList([
        entry('r1', 1, [line({ lineText: '2 onions', quantityMin: 2, ingredientText: 'onion' })]),
        entry('r2', 1, [line({ lineText: 'a few onions', ingredientText: null })]),
      ]);

      // These land in different canonical groups (the unparsed line's
      // identity text is its whole lineText, not just "onion"), which
      // is itself an example of the conservative-merge trade-off —
      // asserted here so a future change to that fallback is a
      // deliberate one.
      expect(findItem(items, 'onion')!.amounts).toEqual(['2 onion']);
      expect(items.some((i) => i.amounts.includes('a few onions'))).toBe(true);
    });

    it('keeps two different unparsed lines separate even under the same canonical group', () => {
      const items = generateGroceryList([
        entry('r1', 1, [line({ lineText: 'Fresh herbs for garnish', ingredientText: null })]),
        entry('r2', 1, [line({ lineText: 'Fresh herbs, chopped fine', ingredientText: null })]),
      ]);

      // Different raw text -> different canonicalKey -> different items.
      const garnish = findItem(items, 'Fresh herbs for garnish');
      const chopped = findItem(items, 'Fresh herbs, chopped fine');
      expect(garnish).toBeDefined();
      expect(chopped).toBeDefined();
      expect(garnish!.itemHash).not.toBe(chopped!.itemHash);
    });
  });

  describe('scaling', () => {
    it('scales by the entry multiplier before merging', () => {
      const items = generateGroceryList([
        entry('r1', 2, [line({ lineText: '1 onion', quantityMin: 1, ingredientText: 'onion' })]),
      ]);

      expect(findItem(items, 'onion')!.amounts).toEqual(['2 onion']);
    });

    // ADR-0026: the multiplier is the stored value itself, not derived
    // from dividing an absolute count by recipe.servingsCount — a
    // fractional multiplier (unrepresentable under the old
    // absolute-servings storage whenever servingsCount was null) scales
    // exactly the same as any other, with nothing to fall back to.
    it('scales by a fractional multiplier the same as any other', () => {
      const items = generateGroceryList([
        entry('r1', 0.5, [line({ lineText: '1 onion', quantityMin: 1, ingredientText: 'onion' })]),
      ]);

      expect(findItem(items, 'onion')!.amounts).toEqual(['1/2 onion']);
    });

    it("leaves an unparsed line's display untouched by scaling", () => {
      const items = generateGroceryList([entry('r1', 2, [line({ lineText: 'a pinch of salt' })])]);

      expect(items.some((i) => i.amounts.includes('a pinch of salt'))).toBe(true);
    });
  });

  // Found via live testing, 2026-08-14: a recipe listing both units for
  // the same quantity ("800g / 28oz crushed tomato") only ever kept
  // whichever one parseQuantity.ts's stripAlternateUnit happened to see
  // first — the grocery list showed that unit even when it didn't match
  // the household's own preference. generateGroceryList() now applies
  // the same convertToSystem() display-time conversion Cooking Mode
  // already uses, before grouping.
  describe('preferred unit system', () => {
    it('converts every occurrence to the household preferred unit system before summing', () => {
      const items = generateGroceryList(
        [
          entry('r1', 1, [
            line({
              lineText: '907.184 g tomato',
              quantityMin: 907.184,
              unit: 'g',
              ingredientText: 'tomato',
            }),
          ]),
        ],
        'us_customary',
      );

      expect(findItem(items, 'tomato')!.amounts).toEqual(['2 lb tomato']);
    });

    it('leaves a quantity already in the preferred system untouched', () => {
      const items = generateGroceryList(
        [
          entry('r1', 1, [
            line({
              lineText: '1 lb beef',
              quantityMin: 1,
              unit: 'lb',
              ingredientText: 'beef',
            }),
          ]),
        ],
        'us_customary',
      );

      expect(findItem(items, 'beef')!.amounts).toEqual(['1 lb beef']);
    });

    it('defaults to no conversion when the caller passes no preference', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({
            lineText: '907.184 g tomato',
            quantityMin: 907.184,
            unit: 'g',
            ingredientText: 'tomato',
          }),
        ]),
      ]);

      expect(findItem(items, 'tomato')!.amounts).toEqual(['~905 g tomato']);
    });
  });

  describe('display text', () => {
    it('drops a preparation clause after the comma from the displayed amount', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({
            lineText: '4 1/2 cups flour, divided',
            quantityMin: 4.5,
            unit: 'cup',
            ingredientText: 'flour, divided',
          }),
        ]),
      ]);

      expect(findItem(items, 'flour')!.amounts).toEqual(['4 1/2 cups flour']);
    });

    it('still merges across occurrences whose clauses differ only after the comma', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({
            lineText: '1 cup flour, divided',
            quantityMin: 1,
            unit: 'cup',
            ingredientText: 'flour, divided',
          }),
        ]),
        entry('r2', 1, [
          line({ lineText: '1 cup flour', quantityMin: 1, unit: 'cup', ingredientText: 'flour' }),
        ]),
      ]);

      const flour = findItem(items, 'flour');
      expect(flour!.amounts).toEqual(['2 cups flour']);
    });

    // Found via live testing, 2026-08-14: canonicalKey() already merged
    // "softened butter" with "butter" (LEADING_PREP_MODIFIERS), but the
    // merged item still displayed whichever occurrence's raw text
    // happened to be first — "1/3 cup softened butter, less than 115
    // degrees" instead of "1/3 cup butter". generateGroceryList.ts's own
    // groceryDisplayText() now strips the same list, not just the merge
    // key.
    it('strips a leading prep-state word from the displayed amount, same list as the merge key', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({
            lineText: '1/3 cup softened butter, less than 115 degrees',
            quantityMin: 1 / 3,
            unit: 'cup',
            ingredientText: 'softened butter, less than 115 degrees',
          }),
        ]),
      ]);

      expect(findItem(items, 'butter')!.amounts).toEqual(['1/3 cup butter']);
    });

    it('merges "softened butter" and "butter" into one line, not two', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({
            lineText: '1/3 cup softened butter',
            quantityMin: 1 / 3,
            unit: 'cup',
            ingredientText: 'softened butter',
          }),
        ]),
        entry('r2', 1, [
          line({
            lineText: '2 tbsp butter',
            quantityMin: 2,
            unit: 'tbsp',
            ingredientText: 'butter',
          }),
        ]),
      ]);

      const butter = findItem(items, 'butter');
      expect(butter!.amounts).toHaveLength(1);
    });

    // Found via live testing, 2026-08-14: "4 tbsp all purpose flour" and
    // "3 cups flour" showed as two separate line items — canonicalKey()
    // now folds "all purpose flour" to "flour" (DEFAULT_VARIETY_PREFIXES),
    // and since tbsp/cup share the volume unit class, they're not just
    // the same item, they sum into one amount.
    it('merges and sums "all purpose flour" with "flour" across compatible units', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '3 cups flour', quantityMin: 3, unit: 'cup', ingredientText: 'flour' }),
        ]),
        entry('r2', 1, [
          line({
            lineText: '4 tbsp all purpose flour',
            quantityMin: 4,
            unit: 'tbsp',
            ingredientText: 'all purpose flour',
          }),
        ]),
      ]);

      const flour = findItem(items, 'flour');
      expect(flour!.amounts).toHaveLength(1);
      // 3 cups + 4 tbsp (1/4 cup), summed in cups (the first occurrence's
      // unit) = 3 1/4 cups — "~" marks a cross-unit conversion, same as
      // the existing volume-merge test above.
      expect(flour!.amounts[0]).toBe('~3 1/4 cups flour');
    });
  });

  describe('categorization and staples', () => {
    it('tags a staple ingredient as excluded-by-default via isStaple', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '1 tsp salt', quantityMin: 1, unit: 'tsp', ingredientText: 'salt' }),
        ]),
      ]);
      expect(findItem(items, 'salt')!.isStaple).toBe(true);
      expect(findItem(items, 'salt')!.category).toBe('pantry');
    });

    it('tags a non-staple ingredient as included by default', () => {
      const items = generateGroceryList([
        entry('r1', 1, [
          line({ lineText: '1 chicken breast', quantityMin: 1, ingredientText: 'chicken breast' }),
        ]),
      ]);
      expect(findItem(items, 'chicken breast')!.isStaple).toBe(false);
      expect(findItem(items, 'chicken breast')!.category).toBe('meat');
    });
  });

  it('ignores an ingredient line that normalizes to an empty canonical key', () => {
    const items = generateGroceryList([entry('r1', 1, [line({ lineText: '   ' })])]);
    expect(items).toHaveLength(0);
  });
});
