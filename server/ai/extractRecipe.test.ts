import Anthropic from '@anthropic-ai/sdk';

import {
  buildExtractionSystemPrompt,
  buildImageExtractionSystemPrompt,
  extractRecipe,
  extractRecipeFromImage,
  RecipeExtractionSchema,
} from './extractRecipe';
import { MESSY_RECIPE_PAGE_TEXT } from './fixtures/messyRecipePage';

// Matches supabase/migrations/20260803100000_recipe_schema.sql's seeded
// values closely enough for these tests — the real list is fetched from
// the DB by the caller (the Edge Function), this file only exercises how
// extractRecipe/extractRecipeFromImage thread it through.
const TEST_CATEGORY_VALUES = ['Chicken', 'Beef', 'Vegetarian', 'Soup', 'Dessert'];

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
    notes: null,
    uncertainFields: [],
  };

  it('accepts a well-formed extraction', () => {
    expect(RecipeExtractionSchema.safeParse(validExtraction).success).toBe(true);
  });

  it('accepts an explicit source note', () => {
    const result = RecipeExtractionSchema.safeParse({
      ...validExtraction,
      notes: 'Freezes well for up to 3 months.',
    });
    expect(result.success).toBe(true);
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

describe('extractRecipe — model selection', () => {
  const confidentExtraction = {
    title: 'Roast Chicken',
    activeTimeMinutes: 20,
    totalTimeMinutes: 70,
    yield: '4 servings',
    ingredientSections: [{ heading: null, items: ['1 whole chicken'] }],
    instructionSections: [{ heading: null, steps: ['Roast it.'] }],
    suggestedCategories: ['Chicken'],
    suggestedTags: ['weeknight'],
    notes: null,
    uncertainFields: [],
  };

  function clientReturning(...results: unknown[]): Anthropic {
    const parse = jest.fn();
    for (const result of results) {
      parse.mockResolvedValueOnce({ parsed_output: result, stop_reason: 'end_turn' });
    }
    return { messages: { parse } } as unknown as Anthropic;
  }

  describe('dev mode (default — useProductionModels omitted)', () => {
    it('always makes a single Haiku call, regardless of uncertainty, no escalation', async () => {
      const uncertainResult = { ...confidentExtraction, uncertainFields: ['title'] };
      const client = clientReturning(uncertainResult);

      const result = await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES);

      expect(result).toEqual(uncertainResult);
      expect(client.messages.parse).toHaveBeenCalledTimes(1);
      expect(client.messages.parse).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      );
    });

    it('is also the behavior when useProductionModels is explicitly false', async () => {
      const client = clientReturning(confidentExtraction);

      await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, {
        useProductionModels: false,
      });

      expect(client.messages.parse).toHaveBeenCalledTimes(1);
      expect(client.messages.parse).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
      );
    });
  });

  describe('production mode (useProductionModels: true)', () => {
    const prodOptions = { useProductionModels: true };

    it('does not escalate when the primary (Sonnet) result looks confident', async () => {
      const client = clientReturning(confidentExtraction);

      const result = await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, prodOptions);

      expect(result).toEqual(confidentExtraction);
      expect(client.messages.parse).toHaveBeenCalledTimes(1);
      expect(client.messages.parse).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-5' }),
      );
    });

    it.each(['title', 'ingredientSections', 'instructionSections'])(
      'escalates to Opus when %s (a mission-critical field) is flagged uncertain',
      async (criticalField) => {
        const escalated = { ...confidentExtraction, title: 'Roast Chicken (opus)' };
        const uncertainPrimary = { ...confidentExtraction, uncertainFields: [criticalField] };
        const client = clientReturning(uncertainPrimary, escalated);

        const result = await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, prodOptions);

        expect(result).toEqual(escalated);
        expect(client.messages.parse).toHaveBeenCalledTimes(2);
        expect(client.messages.parse).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ model: 'claude-opus-5' }),
        );
      },
    );

    it('escalates when every ingredient section came back empty', async () => {
      const noIngredients = {
        ...confidentExtraction,
        ingredientSections: [{ heading: null, items: [] }],
      };
      const client = clientReturning(noIngredients, confidentExtraction);

      await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, prodOptions);

      expect(client.messages.parse).toHaveBeenCalledTimes(2);
    });

    it('escalates when every instruction section came back empty', async () => {
      const noInstructions = {
        ...confidentExtraction,
        instructionSections: [{ heading: null, steps: [] }],
      };
      const client = clientReturning(noInstructions, confidentExtraction);

      await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, prodOptions);

      expect(client.messages.parse).toHaveBeenCalledTimes(2);
    });

    it('does not escalate when only non-critical fields (timing, yield, categories/tags) are uncertain', async () => {
      const nonCriticalUncertainty = {
        ...confidentExtraction,
        uncertainFields: [
          'activeTimeMinutes',
          'totalTimeMinutes',
          'yield',
          'suggestedCategories',
          'suggestedTags',
        ],
      };
      const client = clientReturning(nonCriticalUncertainty);

      const result = await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES, prodOptions);

      expect(result).toEqual(nonCriticalUncertainty);
      expect(client.messages.parse).toHaveBeenCalledTimes(1);
    });
  });

  describe('extractRecipeFromImage — model selection (ADR-0017)', () => {
    it('floors at Sonnet (not Haiku) even without useProductionModels, and does not escalate', async () => {
      const uncertainResult = { ...confidentExtraction, uncertainFields: ['title'] };
      const client = clientReturning(uncertainResult);

      const result = await extractRecipeFromImage(
        client,
        'base64data',
        'image/jpeg',
        TEST_CATEGORY_VALUES,
      );

      expect(result).toEqual(uncertainResult);
      expect(client.messages.parse).toHaveBeenCalledTimes(1);
      expect(client.messages.parse).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-5' }),
      );
    });

    it('sends the image as a base64 content block alongside a text instruction', async () => {
      const client = clientReturning(confidentExtraction);

      await extractRecipeFromImage(client, 'base64data', 'image/png', TEST_CATEGORY_VALUES);

      expect(client.messages.parse).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
                },
                { type: 'text', text: expect.any(String) },
              ],
            },
          ],
        }),
      );
    });

    it('escalates to Opus when a critical field is uncertain and useProductionModels is set', async () => {
      const escalated = { ...confidentExtraction, title: 'Roast Chicken (opus)' };
      const uncertainPrimary = { ...confidentExtraction, uncertainFields: ['ingredientSections'] };
      const client = clientReturning(uncertainPrimary, escalated);

      const result = await extractRecipeFromImage(
        client,
        'base64data',
        'image/jpeg',
        TEST_CATEGORY_VALUES,
        {
          useProductionModels: true,
        },
      );

      expect(result).toEqual(escalated);
      expect(client.messages.parse).toHaveBeenCalledTimes(2);
      expect(client.messages.parse).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: 'claude-opus-5' }),
      );
    });

    it('does not escalate in production mode when the primary result looks confident', async () => {
      const client = clientReturning(confidentExtraction);

      await extractRecipeFromImage(client, 'base64data', 'image/jpeg', TEST_CATEGORY_VALUES, {
        useProductionModels: true,
      });

      expect(client.messages.parse).toHaveBeenCalledTimes(1);
    });
  });
});

describe('category prompt building (ORG-04/AI-06)', () => {
  it('renders each category value, quoted, into the extraction system prompt', () => {
    const prompt = buildExtractionSystemPrompt(TEST_CATEGORY_VALUES);
    for (const value of TEST_CATEGORY_VALUES) {
      expect(prompt).toContain(`"${value}"`);
    }
  });

  it('renders each category value into the image extraction system prompt', () => {
    const prompt = buildImageExtractionSystemPrompt(TEST_CATEGORY_VALUES);
    for (const value of TEST_CATEGORY_VALUES) {
      expect(prompt).toContain(`"${value}"`);
    }
  });

  it('extractRecipe sends a system prompt carrying the given categories', async () => {
    const confidentExtraction = {
      title: 'Roast Chicken',
      activeTimeMinutes: 20,
      totalTimeMinutes: 70,
      yield: '4 servings',
      ingredientSections: [{ heading: null, items: ['1 whole chicken'] }],
      instructionSections: [{ heading: null, steps: ['Roast it.'] }],
      suggestedCategories: ['Chicken'],
      suggestedTags: ['weeknight'],
      notes: null,
      uncertainFields: [],
    };
    const parse = jest
      .fn()
      .mockResolvedValueOnce({ parsed_output: confidentExtraction, stop_reason: 'end_turn' });
    const client = { messages: { parse } } as unknown as Anthropic;

    await extractRecipe(client, 'page text', TEST_CATEGORY_VALUES);

    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining('"Chicken"') }),
    );
  });
});

// Real API call — the actual proof this risk spike exists to produce.
// Skips (not fails) when no key is available, since CI doesn't have
// ANTHROPIC_API_KEY wired in yet (tracked in docs/phase-status.md's
// carried-forward items — this spike is the trigger for adding it). No
// options passed below, so this now costs a single Haiku call rather
// than Sonnet(+Opus) — dev-mode is the default (2026-08-05).
const describeIfApiKey = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

describeIfApiKey('extractRecipe (live API)', () => {
  it('extracts a clean, schema-valid recipe from a messy blog page', async () => {
    const client = new Anthropic();
    const result = await extractRecipe(client, MESSY_RECIPE_PAGE_TEXT, TEST_CATEGORY_VALUES);

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
