/**
 * Heuristic HTML -> recipe-relevant text reducer (ADR-0015 decision 6,
 * prd.md §8: "fetched webpages are reduced to their recipe-relevant text
 * ... before AI parsing"). A regex-based tag-stripper, not a DOM parser —
 * no HTML-parsing dependency exists in this project yet, and adding one
 * is real supply-chain surface (execution-plan.md T8) for something a
 * well-scoped pass handles adequately for typical recipe-blog markup.
 * Revisit with a real parser if the human import-quality review (this
 * phase's own validation bullet) finds sites this mishandles.
 *
 * Two things this buys beyond "smaller AI prompt": it bounds token cost
 * (prd.md §8) and it shrinks the prompt-injection surface of untrusted
 * page content (threat-model.md T5) — scripts, comments, and hidden
 * chrome are gone before any of it reaches Claude, not just visually
 * hidden by CSS.
 */

const STRIPPED_BLOCK_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'footer',
  'aside',
  'form',
  'iframe',
];

// Block-level boundaries become a newline instead of vanishing outright,
// so "Preheat the oven.Mix the flour." doesn't run two sentences
// together once tags are stripped.
//
// header is here, not in STRIPPED_BLOCK_TAGS (found via live testing,
// 2026-08-14): plenty of sites use <header> as a page-level banner, but
// plenty of others also use it as a section's own heading wrapper —
// foodnetwork.com's "Cook's Note" label lives in exactly that shape
// (<section class="o-ChefNotes"><header>Cook's Note</header>...).
// Stripping it wholesale silently deleted the one word that told the
// extraction prompt what kind of aside this was, while the note's body
// text (a sibling element) survived untouched — the label vanished, not
// the content, which is why a prompt fix alone couldn't have caught
// this. A `<nav>` nested inside a `<header>` (the common page-banner
// shape) is still fully removed either way, since `nav` stripping runs
// first.
const NEWLINE_BOUNDARY_TAGS = [
  'p',
  'div',
  'li',
  'tr',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
];

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};

const MIN_USEFUL_LENGTH = 200;
const MAX_OUTPUT_LENGTH = 20_000;

function stripBlockTags(html: string): string {
  let result = html;
  for (const tag of STRIPPED_BLOCK_TAGS) {
    result = result.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '');
    // Self-closing / void form (e.g. a stray <iframe src="..." />).
    result = result.replace(new RegExp(`<${tag}[^>]*/>`, 'gi'), '');
  }
  return result;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(
      /&([a-z0-9]+);/gi,
      (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match,
    );
}

function tagsToText(html: string): string {
  let text = html;
  for (const tag of NEWLINE_BOUNDARY_TAGS) {
    text = text.replace(new RegExp(`</?${tag}[^>]*>`, 'gi'), '\n');
  }
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractRegion(html: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i').exec(html);
  return match ? match[1]! : null;
}

/**
 * Reduces a full HTML page to recipe-relevant plain text. Prefers
 * `<main>`, then `<article>`, then `<body>`, then the whole input — each
 * candidate is tried in that order and the first one that yields enough
 * text (>= 200 chars once stripped) wins, since a `<main>` that's mostly
 * a JS-rendered shell is worse than falling through to `<body>` (the
 * "Content fallback" build-scope item). If nothing clears that bar, the
 * last candidate's text is returned anyway — some signal beats none.
 */
export function reduceHtmlToText(html: string): string {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '');
  const withoutBoilerplate = stripBlockTags(cleaned);

  const candidates = [
    extractRegion(withoutBoilerplate, 'main'),
    extractRegion(withoutBoilerplate, 'article'),
    extractRegion(withoutBoilerplate, 'body'),
    withoutBoilerplate,
  ].filter((candidate): candidate is string => candidate !== null);

  let best = tagsToText(candidates[candidates.length - 1]!);
  for (const candidate of candidates) {
    const text = tagsToText(candidate);
    if (text.length >= MIN_USEFUL_LENGTH) {
      best = text;
      break;
    }
  }

  return best.slice(0, MAX_OUTPUT_LENGTH);
}
