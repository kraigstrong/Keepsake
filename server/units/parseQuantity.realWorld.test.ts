import { parseQuantity } from './parseQuantity';
import { REAL_WORLD_INGREDIENT_CORPUS } from './realWorldIngredientCorpus';

// Regression net over real-world ingredient formatting, distinct from
// parseQuantity.test.ts's hand-picked fixture corpus. A snapshot diff
// here means parseQuantity()'s output changed for a real recipe line —
// worth a human look (a fix generalizing further is a good diff to
// accept; an unnoticed regression is not), not something to hand-verify
// line by line the way the curated fixtures are. See
// realWorldIngredientCorpus.ts's header for scope and provenance.
describe('parseQuantity — real-world ingredient corpus', () => {
  for (const { recipe, lines } of REAL_WORLD_INGREDIENT_CORPUS) {
    it(`parses every line from "${recipe}" without throwing, matching the recorded snapshot`, () => {
      const results = lines.map((line) => ({ line, ...parseQuantity(line) }));
      expect(results).toMatchSnapshot();
    });
  }
});
