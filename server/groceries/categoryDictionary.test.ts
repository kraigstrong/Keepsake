import { canonicalKey } from './canonicalKey';
import { categorize } from './categoryDictionary';

function categorizeText(text: string) {
  return categorize(canonicalKey(text));
}

describe('categorize', () => {
  it.each([
    ['onions, diced', 'produce'],
    ['yellow onion', 'produce'],
    ['bell pepper, sliced', 'produce'],
    ['roma tomatoes', 'produce'],
    ['strawberries', 'produce'],
    ['chicken breast', 'meat'],
    ['ground beef', 'meat'],
    ['shrimp, peeled', 'meat'],
    ['frozen peas', 'frozen'],
    ['frozen chicken breast', 'frozen'],
    ['ice cream', 'frozen'],
    ['whole milk', 'dairy'],
    ['shredded cheddar', 'dairy'],
    ['large eggs', 'dairy'],
    ['all-purpose flour', 'pantry'],
    ['olive oil', 'pantry'],
    ['chicken broth', 'pantry'],
    ['kosher salt', 'pantry'],
    ['beef bouillon', 'pantry'],
    ['chicken bouillon cubes', 'pantry'],
  ])('categorizes "%s" as %s', (text, expected) => {
    expect(categorizeText(text)).toBe(expected);
  });

  it('"beef bouillon" is Pantry, not Meat, despite containing "beef"', () => {
    expect(categorizeText('beef bouillon')).toBe('pantry');
  });

  it('falls back to Other for an unrecognized ingredient', () => {
    expect(categorizeText('xylitol crystals')).toBe('other');
  });

  it('a bare "pepper" defaults to the Pantry spice, not the Produce vegetable', () => {
    expect(categorizeText('pepper')).toBe('pantry');
  });

  it('"chicken broth" is Pantry, not Meat, despite containing "chicken"', () => {
    expect(categorizeText('low sodium chicken broth')).toBe('pantry');
  });
});
