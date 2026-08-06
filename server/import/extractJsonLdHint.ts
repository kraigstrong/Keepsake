/**
 * Extracts schema.org Recipe structured data from a page's
 * `<script type="application/ld+json">` blocks and formats it as a
 * plain-text hint to prepend to reduceHtmlToText's output before the AI
 * extraction call (server/ai/extractRecipe.ts) — never a replacement
 * for that call. See ADR-0019: the PRD's own documented import workflow
 * (prd.md §8: "Page reduced to relevant text -> AI parses ->
 * Uncertainties highlighted -> Save") runs on every import regardless
 * of what this module finds; a richer hint just makes Claude's own
 * result less likely to come back uncertain, it isn't a second
 * decision point or a second write path into save_recipe.
 *
 * Operates on the *original* fetched HTML, before reduceHtmlToText
 * strips <script> tags — same reasoning extractHeroImageUrl.ts already
 * relies on for <head> content reduceHtmlToText also drops.
 *
 * JSON-LD is exactly as untrusted as the rest of the page
 * (threat-model.md T5/T16): a malformed block, a missing/wrong
 * `Recipe` type, or a node with nothing usable in it all resolve to
 * null rather than throwing — the caller falls back to
 * reduceHtmlToText's output alone, same as if this module didn't run.
 * Every extracted string is stripped of embedded HTML and length-capped
 * before being folded into the hint text.
 */

const JSON_LD_SCRIPT_PATTERN =
  /<script[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const MAX_FIELD_LENGTH = 500;
const MAX_LIST_ITEMS = 100;
const MAX_HINT_LENGTH = 4000;
const MAX_FLATTEN_DEPTH = 3;

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

// A numeric entity outside the valid Unicode code point range (e.g. a
// deliberately malformed &#x110000;) makes String.fromCodePoint throw —
// caught per-match so one bad entity degrades to left-as-is text
// instead of aborting extraction for the whole page.
function codePointOrOriginal(match: string, codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) =>
      codePointOrOriginal(match, parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (match, dec: string) => codePointOrOriginal(match, parseInt(dec, 10)))
    .replace(
      /&([a-z0-9]+);/gi,
      (match, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? match,
    );
}

function sanitizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return null;
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}…` : text;
}

// Accepts both the compact term ("Recipe") and an expanded schema.org
// IRI ("https://schema.org/Recipe" / "http://schema.org/Recipe#Recipe"
// and similar) — both are legal JSON-LD for the same type, and real
// pages use either depending on how their markup was generated.
function matchesRecipeTypeString(type: string): boolean {
  const lastSegment = type.split(/[/#]/).pop() ?? type;
  return lastSegment.toLowerCase() === 'recipe';
}

function isRecipeType(type: unknown): boolean {
  if (typeof type === 'string') return matchesRecipeTypeString(type);
  if (Array.isArray(type)) {
    return type.some((t) => typeof t === 'string' && matchesRecipeTypeString(t));
  }
  return false;
}

// A JSON-LD block can be a single object, an array of top-level
// entities, or an object carrying a `@graph` array of entities — all
// three are legal and seen in the wild. The first Recipe node found,
// searched in that order, wins.
function findRecipeNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecipeNode(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const node = value as Record<string, unknown>;
  if (isRecipeType(node['@type'])) return node;
  if (Array.isArray(node['@graph'])) return findRecipeNode(node['@graph']);
  return null;
}

function toStringArray(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value !== undefined && value !== null ? [value] : [];
  return items
    .map((item) => sanitizeText(item))
    .filter((item): item is string => item !== null)
    .slice(0, MAX_LIST_ITEMS);
}

// recipeInstructions accepts a bare string, an array of strings, an
// array of HowToStep objects ({ text }), or an array of HowToSection
// objects (their own { name, itemListElement: HowToStep[] }) — all four
// appear in real recipe-site markup. Flattened into a plain list; a
// HowToSection's own name becomes a heading line so the hint still
// carries the page's section structure, the same signal
// reduceHtmlToText's HTML-based output tries to preserve.
function flattenInstructions(value: unknown, depth = 0): string[] {
  if (depth > MAX_FLATTEN_DEPTH) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n+/)
      .map((line) => sanitizeText(line))
      .filter((line): line is string => line !== null)
      .slice(0, MAX_LIST_ITEMS);
  }
  // A single HowToStep/HowToSection object (not wrapped in an array) is
  // legal JSON-LD — schema.org properties accept a singular value in
  // place of a one-item array — so it's normalized into one here rather
  // than falling through and silently dropping the only instruction.
  const items = Array.isArray(value) ? value : typeof value === 'object' && value !== null ? [value] : null;
  if (!items) return [];

  const lines: string[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const text = sanitizeText(item);
      if (text) lines.push(text);
      continue;
    }
    if (typeof item !== 'object' || item === null) continue;
    const node = item as Record<string, unknown>;
    if (Array.isArray(node.itemListElement)) {
      const heading = sanitizeText(node.name);
      if (heading) lines.push(`${heading}:`);
      lines.push(...flattenInstructions(node.itemListElement, depth + 1));
      continue;
    }
    const text = sanitizeText(node.text ?? node.name);
    if (text) lines.push(text);
  }
  return lines.slice(0, MAX_LIST_ITEMS);
}

// ISO 8601 duration (schema.org prepTime/cookTime/totalTime), e.g.
// "PT1H30M" -> 90. Only day/hour/minute/second components are read —
// the only ones a cook/prep time plausibly uses. An unparseable or
// empty duration returns null rather than a guessed number, matching
// extractRecipe.ts's own never-invent posture for these fields.
function parseIsoDurationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  return (
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Math.round(Number(seconds ?? 0) / 60)
  );
}

function formatMinutes(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Parses every `<script type="application/ld+json">` block on the page
 * for a schema.org Recipe (top-level, in a top-level array, or nested
 * in `@graph` — all three are common) and formats whatever it finds
 * into a plain-text hint block. Returns null if no block parses as
 * JSON, none contains a Recipe, or the Recipe found has no usable
 * name/ingredients/instructions at all.
 */
export function extractJsonLdHint(html: string): string | null {
  let recipe: Record<string, unknown> | null = null;
  for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue;
    }
    recipe = findRecipeNode(parsed);
    if (recipe) break;
  }
  if (!recipe) return null;

  const title = sanitizeText(recipe.name);
  const ingredients = toStringArray(recipe.recipeIngredient);
  const instructions = flattenInstructions(recipe.recipeInstructions);
  if (!title && ingredients.length === 0 && instructions.length === 0) return null;

  const yieldText = sanitizeText(
    Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield,
  );
  const prepTime = formatMinutes(parseIsoDurationMinutes(recipe.prepTime));
  const cookTime = formatMinutes(parseIsoDurationMinutes(recipe.cookTime));
  const totalTime = formatMinutes(parseIsoDurationMinutes(recipe.totalTime));
  const categories = toStringArray(recipe.recipeCategory);
  const keywords =
    typeof recipe.keywords === 'string'
      ? toStringArray(recipe.keywords.split(','))
      : toStringArray(recipe.keywords);

  const lines = [
    "Structured recipe data found in this page's schema.org markup. It may be incomplete, " +
      'stale, or wrong relative to the visible page below — treat it as a starting point, not ' +
      'ground truth, and verify it against the surrounding text.',
  ];
  if (title) lines.push(`Title: ${title}`);
  if (yieldText) lines.push(`Yield: ${yieldText}`);
  if (prepTime) lines.push(`Prep time: ${prepTime}`);
  if (cookTime) lines.push(`Cook time: ${cookTime}`);
  if (totalTime) lines.push(`Total time: ${totalTime}`);
  if (categories.length > 0) lines.push(`Category: ${categories.join(', ')}`);
  if (keywords.length > 0) lines.push(`Keywords: ${keywords.join(', ')}`);
  if (ingredients.length > 0) {
    lines.push('Ingredients:');
    lines.push(...ingredients.map((item) => `- ${item}`));
  }
  if (instructions.length > 0) {
    lines.push('Instructions:');
    lines.push(...instructions.map((item) => `- ${item}`));
  }

  const hint = lines.join('\n');
  return hint.length > MAX_HINT_LENGTH ? hint.slice(0, MAX_HINT_LENGTH) : hint;
}
