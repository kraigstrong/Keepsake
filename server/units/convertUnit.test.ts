import { convertToSystem } from './convertUnit';
import { convertQuantity } from './quantityVocabulary';

describe('quantityVocabulary.convertQuantity — safe conversion table', () => {
  it('converts within volume using standard factors', () => {
    expect(convertQuantity(1, 'cup', 'ml')).toBeCloseTo(236.588, 2);
    expect(convertQuantity(1000, 'ml', 'l')).toBeCloseTo(1, 5);
    expect(convertQuantity(3, 'tsp', 'tbsp')).toBeCloseTo(1, 5);
  });

  it('converts within mass using standard factors', () => {
    expect(convertQuantity(1, 'lb', 'g')).toBeCloseTo(453.592, 2);
    expect(convertQuantity(1000, 'g', 'kg')).toBeCloseTo(1, 5);
  });

  it('never allows a mass<->volume conversion — the unsafe conversion this whole table exists to prevent', () => {
    expect(() => convertQuantity(1, 'cup', 'g')).toThrow(/cannot convert/i);
    expect(() => convertQuantity(1, 'lb', 'ml')).toThrow(/cannot convert/i);
  });
});

describe('convertToSystem — Original/Preferred toggle', () => {
  it('converts a us_customary volume quantity to a best-fit metric unit', () => {
    const result = convertToSystem({ quantityMin: 1, quantityMax: 1, unit: 'cup' as const }, 'metric');
    expect(result.unit).toBe('ml');
    expect(result.quantityMin).toBeCloseTo(236.588, 2);
  });

  it('picks liters over an awkwardly large ml value', () => {
    // ~6.34 cups converts to 1500 ml exactly — the target unit should be
    // liters, not "1500 ml" (ADR-0018's own example of what to avoid).
    const result = convertToSystem({ quantityMin: 1500 / 236.588, quantityMax: 1500 / 236.588, unit: 'cup' as const }, 'metric');
    expect(result.unit).toBe('l');
    expect(result.quantityMin).toBeCloseTo(1.5, 2);
  });

  it('converts a metric mass quantity to a best-fit us_customary unit', () => {
    const result = convertToSystem({ quantityMin: 907.184, quantityMax: 907.184, unit: 'g' as const }, 'us_customary');
    expect(result.unit).toBe('lb');
    expect(result.quantityMin).toBeCloseTo(2, 2);
  });

  it('leaves an already-matching-system quantity completely unchanged, not re-bucketed', () => {
    const result = convertToSystem({ quantityMin: 1500, quantityMax: 1500, unit: 'ml' as const }, 'metric');
    expect(result).toEqual({ quantityMin: 1500, quantityMax: 1500, unit: 'ml' });
  });

  it('never converts a unitless/count quantity', () => {
    const result = convertToSystem({ quantityMin: 3, quantityMax: 3, unit: null }, 'metric');
    expect(result).toEqual({ quantityMin: 3, quantityMax: 3, unit: null });
  });

  it('leaves an unparsed quantity untouched', () => {
    const result = convertToSystem({ quantityMin: null, quantityMax: null, unit: null }, 'metric');
    expect(result).toEqual({ quantityMin: null, quantityMax: null, unit: null });
  });

  it('converts both bounds of a range independently', () => {
    const result = convertToSystem({ quantityMin: 1, quantityMax: 2, unit: 'lb' as const }, 'metric');
    expect(result.unit).toBe('g');
    expect(result.quantityMin).toBeCloseTo(453.592, 2);
    expect(result.quantityMax).toBeCloseTo(907.184, 2);
  });
});
