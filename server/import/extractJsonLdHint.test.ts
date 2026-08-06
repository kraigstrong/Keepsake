import { extractJsonLdHint } from './extractJsonLdHint';

function withScript(json: unknown, attrs = 'type="application/ld+json"'): string {
  return `<html><head><script ${attrs}>${JSON.stringify(json)}</script></head><body></body></html>`;
}

describe('extractJsonLdHint', () => {
  it('extracts a top-level Recipe object', () => {
    const html = withScript({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Chocolate Chip Cookies',
      recipeIngredient: ['2 cups flour', '1 cup sugar'],
      recipeInstructions: ['Preheat oven to 350F.', 'Mix ingredients.'],
      recipeYield: '24 cookies',
      prepTime: 'PT15M',
      cookTime: 'PT10M',
      totalTime: 'PT25M',
      recipeCategory: 'Dessert',
      keywords: 'cookies, chocolate, baking',
    });

    const hint = extractJsonLdHint(html);
    expect(hint).not.toBeNull();
    expect(hint).toContain('Title: Chocolate Chip Cookies');
    expect(hint).toContain('Yield: 24 cookies');
    expect(hint).toContain('Prep time: 15 min');
    expect(hint).toContain('Cook time: 10 min');
    expect(hint).toContain('Total time: 25 min');
    expect(hint).toContain('Category: Dessert');
    expect(hint).toContain('Keywords: cookies, chocolate, baking');
    expect(hint).toContain('- 2 cups flour');
    expect(hint).toContain('- 1 cup sugar');
    expect(hint).toContain('- Preheat oven to 350F.');
    expect(hint).toContain('- Mix ingredients.');
  });

  it('finds a Recipe nested inside an @graph array', () => {
    const html = withScript({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Some Blog' },
        {
          '@type': 'Recipe',
          name: 'Graph Recipe',
          recipeIngredient: ['1 egg'],
          recipeInstructions: ['Crack the egg.'],
        },
      ],
    });

    const hint = extractJsonLdHint(html);
    expect(hint).toContain('Title: Graph Recipe');
    expect(hint).toContain('- 1 egg');
  });

  it('matches a Recipe whose @type is an array of types', () => {
    const html = withScript({
      '@type': ['NewsArticle', 'Recipe'],
      name: 'Multi-typed Recipe',
      recipeIngredient: ['Salt'],
      recipeInstructions: ['Add salt.'],
    });

    expect(extractJsonLdHint(html)).toContain('Title: Multi-typed Recipe');
  });

  it('finds a Recipe inside a top-level array of entities', () => {
    const html = withScript([
      { '@type': 'Organization', name: 'Acme' },
      { '@type': 'Recipe', name: 'Array Recipe', recipeIngredient: ['Water'] },
    ]);

    expect(extractJsonLdHint(html)).toContain('Title: Array Recipe');
  });

  it('flattens HowToStep instructions', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Step Recipe',
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Preheat the oven.' },
        { '@type': 'HowToStep', text: 'Bake for 20 minutes.' },
      ],
    });

    const hint = extractJsonLdHint(html);
    expect(hint).toContain('- Preheat the oven.');
    expect(hint).toContain('- Bake for 20 minutes.');
  });

  it('flattens HowToSection instructions, keeping section headings', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Sectioned Recipe',
      recipeInstructions: [
        {
          '@type': 'HowToSection',
          name: 'For the sauce',
          itemListElement: [
            { '@type': 'HowToStep', text: 'Simmer the tomatoes.' },
            { '@type': 'HowToStep', text: 'Add basil.' },
          ],
        },
        {
          '@type': 'HowToSection',
          name: 'For the pasta',
          itemListElement: [{ '@type': 'HowToStep', text: 'Boil the pasta.' }],
        },
      ],
    });

    const hint = extractJsonLdHint(html);
    expect(hint).toContain('For the sauce:');
    expect(hint).toContain('- Simmer the tomatoes.');
    expect(hint).toContain('- Add basil.');
    expect(hint).toContain('For the pasta:');
    expect(hint).toContain('- Boil the pasta.');
  });

  it('handles recipeInstructions as a single newline-separated string', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Blob Recipe',
      recipeInstructions: 'Step one.\nStep two.',
    });

    const hint = extractJsonLdHint(html);
    expect(hint).toContain('- Step one.');
    expect(hint).toContain('- Step two.');
  });

  it('takes the first element when recipeYield is an array', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Yield Array Recipe',
      recipeIngredient: ['x'],
      recipeYield: ['4', '4 servings'],
    });

    expect(extractJsonLdHint(html)).toContain('Yield: 4');
  });

  it('formats durations over an hour as hours and minutes', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Long Bake',
      recipeIngredient: ['x'],
      totalTime: 'PT1H30M',
    });

    expect(extractJsonLdHint(html)).toContain('Total time: 1 hr 30 min');
  });

  it('formats a whole-hour duration without a minutes remainder', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Two Hour Bake',
      recipeIngredient: ['x'],
      totalTime: 'PT2H',
    });

    expect(extractJsonLdHint(html)).toContain('Total time: 2 hr');
  });

  it('omits a duration field entirely when it cannot be parsed', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Bad Duration',
      recipeIngredient: ['x'],
      totalTime: 'not-a-duration',
    });

    expect(extractJsonLdHint(html)).not.toContain('Total time');
  });

  it('strips embedded HTML and decodes entities in text fields', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Salt &amp; Pepper <b>Chicken</b>',
      recipeIngredient: ['1 tsp salt &amp; pepper'],
    });

    const hint = extractJsonLdHint(html);
    expect(hint).toContain('Title: Salt & Pepper Chicken');
    expect(hint).toContain('- 1 tsp salt & pepper');
    expect(hint).not.toContain('<b>');
  });

  it('caps an individual field at MAX_FIELD_LENGTH characters', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'x'.repeat(1000),
      recipeIngredient: ['y'],
    });

    const hint = extractJsonLdHint(html)!;
    const titleLine = hint.split('\n').find((l) => l.startsWith('Title:'))!;
    expect(titleLine.length).toBeLessThan(520);
    expect(titleLine.endsWith('…')).toBe(true);
  });

  it('caps the number of ingredient list items', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Huge Recipe',
      recipeIngredient: Array.from({ length: 500 }, (_, i) => `ingredient ${i}`),
    });

    const hint = extractJsonLdHint(html)!;
    const bulletCount = hint.split('\n').filter((l) => l.startsWith('- ingredient')).length;
    expect(bulletCount).toBeLessThanOrEqual(100);
  });

  it('caps the total hint length', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Huge Recipe',
      recipeIngredient: Array.from({ length: 500 }, (_, i) => `ingredient number ${i} `.repeat(10)),
    });

    const hint = extractJsonLdHint(html)!;
    expect(hint.length).toBeLessThanOrEqual(4000);
  });

  it('returns null when there is no ld+json script at all', () => {
    expect(extractJsonLdHint('<html><body><p>No structured data here.</p></body></html>')).toBeNull();
  });

  it('returns null when ld+json is present but not a Recipe', () => {
    const html = withScript({ '@type': 'BreadcrumbList', itemListElement: [] });
    expect(extractJsonLdHint(html)).toBeNull();
  });

  it('returns null when the JSON is malformed', () => {
    const html =
      '<html><head><script type="application/ld+json">{ this is not valid json }</script></head></html>';
    expect(extractJsonLdHint(html)).toBeNull();
  });

  it('skips a malformed block and still finds a Recipe in a later block', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{ not valid json }</script>
        <script type="application/ld+json">${JSON.stringify({
          '@type': 'Recipe',
          name: 'Second Block Recipe',
          recipeIngredient: ['flour'],
        })}</script>
      </head></html>
    `;
    expect(extractJsonLdHint(html)).toContain('Title: Second Block Recipe');
  });

  it('returns null when a Recipe node has no usable fields', () => {
    const html = withScript({ '@type': 'Recipe', author: 'Someone' });
    expect(extractJsonLdHint(html)).toBeNull();
  });

  it('is case-insensitive on the script type attribute and @type value', () => {
    const html =
      `<script Type="Application/Ld+Json">` +
      JSON.stringify({ '@type': 'recipe', name: 'Lowercase Type', recipeIngredient: ['x'] }) +
      `</script>`;
    expect(extractJsonLdHint(html)).toContain('Title: Lowercase Type');
  });

  it('does not throw on deeply nested or malformed itemListElement structures', () => {
    const html = withScript({
      '@type': 'Recipe',
      name: 'Weird Nesting',
      recipeIngredient: ['x'],
      recipeInstructions: [{ '@type': 'HowToSection', name: 'A', itemListElement: null }],
    });
    expect(() => extractJsonLdHint(html)).not.toThrow();
  });
});
