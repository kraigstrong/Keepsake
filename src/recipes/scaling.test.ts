import { scaledIngredientSections } from './scaling';
import type { IngredientSection } from './api';

const sections: IngredientSection[] = [
  {
    title: null,
    lines: [
      {
        lineText: '2 cups flour',
        quantityMin: 2,
        quantityMax: null,
        unit: 'cup',
        ingredientText: 'flour',
      },
    ],
  },
];

describe('scaledIngredientSections', () => {
  it('scales quantities by the given multiplier', () => {
    const result = scaledIngredientSections(sections, 2, 'original', null);
    expect(result[0]!.lines[0]).toContain('4');
  });

  it('leaves quantities unscaled at 1x', () => {
    const result = scaledIngredientSections(sections, 1, 'original', null);
    expect(result[0]!.lines[0]).toContain('2');
  });

  it('preserves section titles', () => {
    const titled: IngredientSection[] = [{ title: 'Sauce', lines: [] }];
    const result = scaledIngredientSections(titled, 1, 'original', null);
    expect(result[0]!.title).toBe('Sauce');
  });

  it('falls back to the raw line text when there is no parsed quantity', () => {
    const unparsed: IngredientSection[] = [
      {
        title: null,
        lines: [
          {
            lineText: 'Salt, to taste',
            quantityMin: null,
            quantityMax: null,
            unit: null,
            ingredientText: null,
          },
        ],
      },
    ];
    const result = scaledIngredientSections(unparsed, 2, 'original', null);
    expect(result[0]!.lines[0]).toBe('Salt, to taste');
  });
});
