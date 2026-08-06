import { formatQuantity } from './formatQuantity';

describe('formatQuantity — kitchen-friendly rounding', () => {
  it('rounds a fraction-friendly unit to the nearest common fraction', () => {
    expect(formatQuantity(0.5, 'cup')).toEqual({ display: '1/2', isApproximate: false });
    expect(formatQuantity(1, 'cup')).toEqual({ display: '1', isApproximate: false });
    expect(formatQuantity(2.5, 'tsp')).toEqual({ display: '2 1/2', isApproximate: false });
  });

  it('rounds an ugly decimal to the nearest common fraction and flags it approximate', () => {
    // 1/3 cup doubled is 0.6666...; nearest common fraction is 2/3.
    const result = formatQuantity(2 / 3, 'cup');
    expect(result.display).toBe('2/3');
    expect(result.isApproximate).toBe(false);

    const messy = formatQuantity(0.61, 'cup');
    expect(messy.display).toBe('5/8');
    expect(messy.isApproximate).toBe(true);
  });

  it('never displays a nonzero small quantity as 0 (small quantity rounding floor)', () => {
    const result = formatQuantity(0.02, 'tsp');
    expect(result.display).not.toBe('0');
    expect(result.isApproximate).toBe(true);
  });

  it('rounds a decimal-style unit to a magnitude-appropriate step', () => {
    expect(formatQuantity(1, 'lb')).toEqual({ display: '1', isApproximate: false });
    expect(formatQuantity(2.13, 'lb')).toEqual({ display: '2.25', isApproximate: true });
    expect(formatQuantity(48, 'oz')).toEqual({ display: '48', isApproximate: false });
  });

  it('degrades an extreme value to a coarser step rather than a long decimal', () => {
    const result = formatQuantity(3172.4, 'g');
    expect(result.display).toBe('3175');
    expect(result.isApproximate).toBe(true);
  });

  it('floors an extreme-but-tiny scaled-down value above 0', () => {
    const result = formatQuantity(0.001, 'g');
    expect(result.display).not.toBe('0');
  });

  it('formats an exact whole number without an approximation marker', () => {
    expect(formatQuantity(4, null)).toEqual({ display: '4', isApproximate: false });
  });
});
