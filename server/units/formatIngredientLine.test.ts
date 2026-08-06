import { formatIngredientLine } from './formatIngredientLine';

describe('formatIngredientLine', () => {
  it('formats a parsed single value with unit and ingredient text', () => {
    const line = formatIngredientLine({
      lineText: '2 lb baby potatoes, halved',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'baby potatoes, halved',
    });
    expect(line).toBe('2 lb baby potatoes, halved');
  });

  it('pluralizes a word-form unit based on the displayed quantity', () => {
    const one = formatIngredientLine({
      lineText: '',
      quantityMin: 1,
      quantityMax: 1,
      unit: 'cup',
      ingredientText: 'flour',
    });
    const many = formatIngredientLine({
      lineText: '',
      quantityMin: 2,
      quantityMax: 2,
      unit: 'cup',
      ingredientText: 'flour',
    });
    expect(one).toBe('1 cup flour');
    expect(many).toBe('2 cups flour');
  });

  it('formats a range as "min-max unit"', () => {
    const line = formatIngredientLine({
      lineText: '',
      quantityMin: 1,
      quantityMax: 2,
      unit: 'lb',
      ingredientText: 'chicken breasts',
    });
    expect(line).toBe('1-2 lb chicken breasts');
  });

  it('shows a unitless/count quantity without a unit label', () => {
    const line = formatIngredientLine({
      lineText: '',
      quantityMin: 3,
      quantityMax: 3,
      unit: null,
      ingredientText: 'eggs',
    });
    expect(line).toBe('3 eggs');
  });

  it('prefixes an approximation indicator when rounding changed the value', () => {
    const line = formatIngredientLine({
      lineText: '',
      quantityMin: 0.61,
      quantityMax: 0.61,
      unit: 'cup',
      ingredientText: 'sugar',
    });
    expect(line).toBe('~5/8 cup sugar');
  });

  it('falls back to the original line text verbatim when unparsed — original values never lost', () => {
    const line = formatIngredientLine({
      lineText: 'a pinch of salt',
      quantityMin: null,
      quantityMax: null,
      unit: null,
      ingredientText: null,
    });
    expect(line).toBe('a pinch of salt');
  });
});
