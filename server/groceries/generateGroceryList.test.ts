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
