import { canonicalKey } from './canonicalKey';
import { isStaple } from './staples';

function isStapleText(text: string) {
  return isStaple(canonicalKey(text));
}

describe('isStaple', () => {
  it.each([
    'salt',
    'Salt, to taste',
    'black pepper',
    'olive oil, extra virgin',
    'all-purpose flour',
    'water',
    'baking soda',
    'soy sauce',
  ])('treats "%s" as a staple', (text) => {
    expect(isStapleText(text)).toBe(true);
  });

  it.each(['chicken breast', 'onion', 'heavy cream', 'fresh basil', 'ground beef'])(
    'does not treat "%s" as a staple',
    (text) => {
      expect(isStapleText(text)).toBe(false);
    },
  );
});
