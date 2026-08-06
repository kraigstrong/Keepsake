import { scaleQuantity } from './scaleQuantity';

describe('scaleQuantity', () => {
  it('multiplies a single value', () => {
    expect(scaleQuantity({ quantityMin: 2, quantityMax: 2 }, 2)).toEqual({
      quantityMin: 4,
      quantityMax: 4,
    });
  });

  it('multiplies both bounds of a range independently', () => {
    expect(scaleQuantity({ quantityMin: 1, quantityMax: 2 }, 3)).toEqual({
      quantityMin: 3,
      quantityMax: 6,
    });
  });

  it('handles fractional presets like 1/2x and 1.5x', () => {
    expect(scaleQuantity({ quantityMin: 2, quantityMax: 2 }, 0.5)).toEqual({
      quantityMin: 1,
      quantityMax: 1,
    });
    expect(scaleQuantity({ quantityMin: 2, quantityMax: 2 }, 1.5)).toEqual({
      quantityMin: 3,
      quantityMax: 3,
    });
  });

  it('leaves an unparsed (null) quantity untouched, never inventing a value', () => {
    expect(scaleQuantity({ quantityMin: null, quantityMax: null }, 4)).toEqual({
      quantityMin: null,
      quantityMax: null,
    });
  });

  it('preserves extra fields on the object it scales', () => {
    const result = scaleQuantity(
      { quantityMin: 2, quantityMax: 2, unit: 'cup', lineText: '2 cups flour' },
      2,
    );
    expect(result).toEqual({
      quantityMin: 4,
      quantityMax: 4,
      unit: 'cup',
      lineText: '2 cups flour',
    });
  });
});
