import Anthropic from '@anthropic-ai/sdk';

import { extractRecipe, RecipeExtractionSchema } from './extractRecipe';
import { MESSY_RECIPE_PAGE_TEXT } from './fixtures/messyRecipePage';

describe('RecipeExtractionSchema', () => {
  const validExtraction = {
    title: "Grandma's Sunday Sauce",
    activeTimeMinutes: 30,
    totalTimeMinutes: 90,
    yield: '6 servings',
    ingredientSections: [{ heading: 'For the sauce', items: ['2 tbsp olive oil'] }],
    instructionSections: [{ heading: null, steps: ['Heat the oil.'] }],
    suggestedCategories: ['Main'],
    suggestedTags: ['italian', 'comfort-food'],
    uncertainFields: [],
  };

  it('accepts a well-formed extraction', () => {
    expect(RecipeExtractionSchema.safeParse(validExtraction).success).toBe(true);
  });

  it('rejects an extraction carrying a description field (REC-09)', () => {
    const result = RecipeExtractionSchema.safeParse({ ...validExtraction, description: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const { title: _title, ...withoutTitle } = validExtraction;
    expect(RecipeExtractionSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('allows null time/yield fields (for genuinely unstated values)', () => {
    const result = RecipeExtractionSchema.safeParse({
      ...validExtraction,
      activeTimeMinutes: null,
      totalTimeMinutes: null,
      yield: null,
      uncertainFields: ['activeTimeMinutes', 'totalTimeMinutes', 'yield'],
    });
    expect(result.success).toBe(true);
  });
});

// Real API call — the actual proof this risk spike exists to produce.
// Skips (not fails) when no key is available, since CI doesn't have
// ANTHROPIC_API_KEY wired in yet (tracked in docs/phase-status.md's
// carried-forward items — this spike is the trigger for adding it).
const describeIfApiKey = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

describeIfApiKey('extractRecipe (live API)', () => {
  it('extracts a clean, schema-valid recipe from a messy blog page', async () => {
    const client = new Anthropic();
    const result = await extractRecipe(client, MESSY_RECIPE_PAGE_TEXT);

    // Schema conformance is guaranteed by messages.parse() — the
    // interesting assertions are about extraction *quality*.
    expect(result.title.toLowerCase()).toContain('sunday sauce');

    // AI-01: blog narrative removed, not carried into any field.
    const allText = JSON.stringify(result).toLowerCase();
    expect(allText).not.toContain('instagram');
    expect(allText).not.toContain('bologna');
    expect(allText).not.toContain('hummus');

    // REC-02: the page's two implicit sections ("For the sauce" /
    // "For the meatballs") should be preserved, not flattened.
    expect(result.ingredientSections.length).toBeGreaterThanOrEqual(2);

    // AI-03: quantities inline in ingredient item text.
    const firstIngredient = result.ingredientSections[0]?.items[0] ?? '';
    expect(firstIngredient).toMatch(/\d/);

    // Sanity: something ended up in every major section.
    expect(result.instructionSections.length).toBeGreaterThan(0);
    expect(result.instructionSections[0]?.steps.length).toBeGreaterThan(0);
  }, 30_000);
});
