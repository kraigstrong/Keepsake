import { parseServings } from './parseServings';

describe('parseServings', () => {
  it('parses a clear single serving count', () => {
    expect(parseServings('Serves 4')).toBe(4);
    expect(parseServings('Serves 4 people')).toBe(4);
    expect(parseServings('Serves: 4')).toBe(4);
    expect(parseServings('12 servings')).toBe(12);
    expect(parseServings('1 serving')).toBe(1);
  });

  it('leaves a serving range unparsed rather than guessing a bound', () => {
    expect(parseServings('Serves 4-6')).toBeNull();
    expect(parseServings('Serves 4 to 6')).toBeNull();
  });

  it('leaves a non-serving yield unparsed', () => {
    expect(parseServings('Makes one 9x13 pan')).toBeNull();
    expect(parseServings('Makes 2 loaves')).toBeNull();
    expect(parseServings('12 cookies')).toBeNull();
  });

  it('returns null for null/empty yield text', () => {
    expect(parseServings(null)).toBeNull();
    expect(parseServings('')).toBeNull();
  });

  it('rejects an extreme or nonsensical count', () => {
    expect(parseServings('Serves 0')).toBeNull();
    expect(parseServings('Serves 99999')).toBeNull();
  });
});
