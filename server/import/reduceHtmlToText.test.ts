import { reduceHtmlToText } from './reduceHtmlToText';

const FULL_RECIPE_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Herb Roast Chicken</title>
  <style>.hero { color: red; }</style>
  <script>window.dataLayer = window.dataLayer || [];</script>
</head>
<body>
  <!-- top ad slot -->
  <header><nav><a href="/">Home</a><a href="/recipes">Recipes</a></nav></header>
  <aside class="sidebar"><h3>Trending</h3><a href="/x">Other Recipe</a></aside>
  <main>
    <h1>Herb Roast Chicken</h1>
    <p>My grandmother taught me this recipe &mdash; it&rsquo;s a family favorite.</p>
    <script>trackPageview();</script>
    <div class="ingredients">
      <h2>Ingredients</h2>
      <li>1 whole chicken (4&nbsp;lb)</li>
      <li>2 tbsp olive oil</li>
    </div>
    <div class="instructions">
      <h2>Instructions</h2>
      <p>Heat oven to 425&deg;F.</p>
      <p>Roast for 55&ndash;65 minutes.</p>
    </div>
    <form class="print-form"><button>Print</button></form>
    <svg class="icon"><path d="M0 0"/></svg>
  </main>
  <footer><p>&copy; 2026 Example Site</p></footer>
  <iframe src="https://ads.example.com/slot"></iframe>
</body>
</html>
`;

describe('reduceHtmlToText', () => {
  it("extracts the <main> content, dropping nav/footer/aside (and a <header>'s nested nav)", () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);

    expect(text).toContain('Herb Roast Chicken');
    expect(text).toContain('Ingredients');
    expect(text).toContain('1 whole chicken (4 lb)');
    expect(text).toContain('Roast for 55–65 minutes.');

    // "Home" lives inside <header><nav>...</nav></header> in the fixture
    // above — gone because nav stripping still removes it, not because
    // header itself is stripped (it isn't, see below).
    expect(text).not.toContain('Home');
    expect(text).not.toContain('Trending');
    expect(text).not.toContain('Other Recipe');
    expect(text).not.toContain('Example Site');
    expect(text).not.toContain('Print');
  });

  // Found via live testing, 2026-08-14: foodnetwork.com's "Cook's Note"
  // label lives in a <header> used as a section's own heading, not a
  // page banner — stripping every <header> wholesale silently deleted
  // the label while the note's body text (a sibling element) survived,
  // so the extraction prompt received an unlabeled orphan paragraph and
  // correctly nulled it out per its own "no clear label, no note" rule.
  it("keeps a <header> used as a section's own sub-heading, not just the page banner", () => {
    const html = `
      <html><body>
        <main>
          <h1>Crepes</h1>
          <p>${'Real recipe text so this main region clears the usefulness threshold on its own, same as the other fixtures in this file. '.repeat(5)}</p>
          <section class="notes">
            <header>Cook's Note</header>
            <p>Add fresh herbs for a savory variation.</p>
          </section>
        </main>
      </body></html>
    `;
    const text = reduceHtmlToText(html);

    expect(text).toContain("Cook's Note");
    expect(text).toContain('Add fresh herbs for a savory variation.');
    expect(text.indexOf("Cook's Note")).toBeLessThan(text.indexOf('Add fresh herbs'));
  });

  it('strips script and style tags and their contents entirely', () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);

    expect(text).not.toContain('dataLayer');
    expect(text).not.toContain('trackPageview');
    expect(text).not.toContain('color: red');
  });

  it('strips HTML comments', () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);
    expect(text).not.toContain('top ad slot');
  });

  it('strips svg and iframe content', () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);
    expect(text).not.toContain('ads.example.com');
    expect(text).not.toContain('M0 0');
  });

  it('decodes common HTML entities', () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);
    expect(text).toContain('—');
    expect(text).toContain('’s a family favorite');
    expect(text).toContain('4 lb');
  });

  it('separates block-level content instead of running it together', () => {
    const text = reduceHtmlToText(FULL_RECIPE_PAGE);
    expect(text).not.toMatch(/oil.{0,3}Instructions/);
  });

  it('falls back to <article> when there is no <main>', () => {
    const html = `
      <html><body>
        <header><nav>Home</nav></header>
        <article><h1>Weeknight Tacos</h1><p>${'Fill this article out with plenty of real recipe text so it clears the usefulness threshold and is preferred over the body fallback. '.repeat(5)}</p></article>
        <footer>Site footer</footer>
      </body></html>
    `;
    const text = reduceHtmlToText(html);
    expect(text).toContain('Weeknight Tacos');
    expect(text).not.toContain('Home');
    expect(text).not.toContain('Site footer');
  });

  it('falls back to <body> when there is no <main> or <article>', () => {
    const html = `
      <html><body>
        <div class="recipe">
          <h1>Simple Pasta</h1>
          <p>${'Boil water, add pasta, cook until tender, then toss with olive oil and parmesan. '.repeat(5)}</p>
        </div>
      </body></html>
    `;
    const text = reduceHtmlToText(html);
    expect(text).toContain('Simple Pasta');
    expect(text).toContain('Boil water');
  });

  it('falls through a sparse <main> (JS-rendered shell) to a fuller <body>', () => {
    const html = `
      <html><body>
        <main id="app"></main>
        <div class="recipe">
          <h1>Server-Rendered Fallback Recipe</h1>
          <p>${'This content only exists outside the empty JS shell main tag, but the body as a whole still has plenty of real text once the main tag is excluded from consideration. '.repeat(5)}</p>
        </div>
      </body></html>
    `;
    const text = reduceHtmlToText(html);
    expect(text).toContain('Server-Rendered Fallback Recipe');
  });

  it('caps output length', () => {
    const hugeParagraph = '<p>' + 'word '.repeat(10_000) + '</p>';
    const html = `<html><body><main>${hugeParagraph}</main></body></html>`;
    const text = reduceHtmlToText(html);
    expect(text.length).toBeLessThanOrEqual(20_000);
  });
});
