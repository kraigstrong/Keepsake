import { canonicalKey } from './canonicalKey';
import { isStaple } from './staples';

function isStapleText(text: string) {
  return isStaple(canonicalKey(text));
}

describe('isStaple', () => {
  it.each([
    'salt',
    'Salt, to taste',
    'kosher salt',
    'sea salt',
    'black pepper',
    'olive oil, extra virgin',
    'all-purpose flour',
    'water',
    'baking soda',
    'soy sauce',
    'white sugar',
    'granulated sugar',
  ])('treats "%s" as a staple', (text) => {
    expect(isStapleText(text)).toBe(true);
  });

  it.each([
    'chicken breast',
    'onion',
    'heavy cream',
    'fresh basil',
    'ground beef',
    // Deliberately still not staples even though they share a word with
    // one (staples.ts stays exact-match, not substring, precisely to
    // avoid this): a generic "pepper"/"water" substring match would
    // wrongly demote real purchases to "probably already have it".
    'bell pepper',
    'coconut water',
    'sparkling water',
  ])('does not treat "%s" as a staple', (text) => {
    expect(isStapleText(text)).toBe(false);
  });
});
