import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

/**
 * Server-side only — never import this from src/ (the Expo/RN client
 * bundle). This is Phase 1's proof that Claude structured extraction
 * works; Phase 8 wires it into the real import pipeline (a Supabase Edge
 * Function, not this Node module directly — the schema/prompt design
 * carries over, the runtime host doesn't). Phase 10 (ADR-0017) adds
 * extractRecipeFromImage, a vision-input sibling to extractRecipe that
 * shares this same schema and the same Sonnet/Opus escalation logic.
 *
 * Every field maps to an explicit PRD requirement so the schema itself
 * documents what it's for:
 *   title/activeTimeMinutes/totalTimeMinutes/yield -> REC-01
 *   ingredientSections                              -> REC-02
 *   instructionSections                              -> REC-03
 *   suggestedCategories/suggestedTags                -> AI-06 / ORG-04
 *   notes                                             -> REC-04 (developer decision, 2026-08-07)
 *   uncertainFields                                   -> AI-07, AI-08
 * No `description` field — prd.md REC-09 says that field must not exist.
 * `notes` is not that field reappearing under a new name: it's gated to an
 * explicit, labeled author aside (see the prompt's own criteria below),
 * never a summary or paraphrase of the page's narrative/SEO content — the
 * exact thing REC-09 exists to keep out.
 *
 * .strict() rejects unrecognized keys instead of silently dropping them,
 * which makes REC-09 an enforced, testable constraint rather than just an
 * absent key nobody would notice drifting. Not extra strictness beyond
 * what the API already mandates — Anthropic's structured-output feature
 * requires `additionalProperties: false` on every object regardless.
 */
export const RecipeExtractionSchema = z
  .object({
    title: z.string(),
    activeTimeMinutes: z.number().int().nullable(),
    totalTimeMinutes: z.number().int().nullable(),
    yield: z.string().nullable(),
    ingredientSections: z.array(
      z.object({
        heading: z.string().nullable(),
        items: z.array(z.string()),
      }),
    ),
    instructionSections: z.array(
      z.object({
        heading: z.string().nullable(),
        steps: z.array(z.string()),
      }),
    ),
    suggestedCategories: z.array(z.string()),
    // Capped at 3 (developer product decision, 2026-08-07): free-form,
    // AI-suggested tags with no cap fragmented into an unwieldy filter
    // vocabulary after only a handful of recipes. The prompt's own
    // tag-worthiness criteria do the real narrowing; this is a hard
    // backstop against the model padding the list regardless.
    suggestedTags: z.array(z.string()).max(3),
    /**
     * The recipe's own explicit tip/note callout — e.g. a labeled "Tip,"
     * "Note," or "Chef's Note" section — captured only when the source
     * genuinely has one; null otherwise. See the prompt's own rules for
     * the exact inclusion/exclusion criteria (developer decision,
     * 2026-08-07: too easy for this to become a dumping ground for the
     * same blog narrative REC-09 already excludes, so the bar is
     * deliberately narrow and null is the expected common case).
     */
    notes: z.string().nullable(),
    /**
     * Field names (e.g. "activeTimeMinutes") the model was not confident
     * about. Populating this — instead of a plausible-looking guess — is
     * how AI-08 ("never confidently invent") actually gets enforced; the
     * schema alone can't stop a model from filling in a guessed number.
     */
    uncertainFields: z.array(z.string()),
  })
  .strict();

export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>;

// Rendered into both system prompts below as a quoted, comma-separated
// list, so the model picks from the actual seeded vocabulary instead of
// free-associating a category name that then has to coincidentally
// string-match it (ORG-04/AI-06 — see docs/history/phase-08-url-import.md).
function formatCategoryList(categoryValues: string[]): string {
  return categoryValues.map((value) => `"${value}"`).join(', ');
}

export function buildExtractionSystemPrompt(categoryValues: string[]): string {
  return `You extract a single recipe from webpage text that has already been reduced to its main content — navigation, ads, comments, and unrelated blog narrative have been stripped before it reached you, but some may remain.

Rules:
- Remove any remaining blog narrative, life-story, or SEO filler — return only the recipe itself.
- Rewrite instructions clearly and concisely; do not copy awkward phrasing verbatim.
- Include each ingredient's quantity inline in its own item text (e.g. "2 cups flour", not a separate quantity field).
- Preserve the page's own section structure for ingredients and instructions (e.g. "For the sauce" / "For the crust") when present; use a single unheaded section when the page has no sections.
- Infer active time, total time, and yield when the page implies them even if not stated in exact numbers, but do NOT invent a specific number you cannot support from the text.
- For any field you are not confident about, still provide your best value (or null for numeric/yield fields), but add that field's name to uncertainFields. Never silently guess — flag it instead.
- suggestedCategories: infer from the recipe's content which of the following categories genuinely apply — choose zero or more, but ONLY from this exact list; never invent a category outside it: ${formatCategoryList(categoryValues)}.
- suggestedTags: your own free-form inference from the recipe's content, not necessarily anything stated explicitly on the page. At most 3, short (one or two words), lowercase. Only tag a genuinely distinguishing, reusable attribute a cook would filter or search for later — diet (e.g. "vegetarian"), cuisine (e.g. "italian"), technique (e.g. "one-pot"), or occasion (e.g. "holiday"). Do not restate the title, an ingredient, or anything already captured in suggestedCategories, and do not invent a one-off descriptor so specific it wouldn't ever apply to another recipe. When in doubt, tag less.
- notes: null unless the page has its own explicit, clearly labeled aside — a section actually headed "Tip," "Note," "Cook's Note," "Chef's Note," "Variation," or "Storage" (or an equivalent unmistakable label) — giving practical guidance about making, storing, or serving this dish. If present, copy its substance concisely; do not pad it or add anything not in that section. This is NOT a place to summarize the page, restate an instruction, or rescue any of the blog narrative/SEO filler you were told to remove above — if you are inferring or synthesizing rather than copying an explicit labeled aside, the answer is null. When in doubt, null.`;
}

// Default to the cheaper/faster model; escalate to Opus only when Sonnet's
// own result looks like it struggled (see seemsUncertain below), rather
// than paying Opus's cost/latency on every call. Developer decision,
// 2026-08-05 — supersedes this file's earlier "defaults to claude-opus-5
// per this project's model-choice policy" note (docs/risk-spikes/
// claude-extraction.md's "Cost/model tuning" open item, now resolved).
// This is the production model strategy — see useProductionModels below
// for why it's opt-in, not the default.
const PRIMARY_MODEL = 'claude-sonnet-5';
const ESCALATION_MODEL = 'claude-opus-5';

// A single, cheap Haiku call, no escalation — every non-production call
// uses this instead (developer decision, 2026-08-05): the
// Sonnet-primary/Opus-escalation cost adds up fast while iterating (a
// live Opus-only call was ~6 cents mid-Phase-8) for no benefit until
// there's a real user-facing result to care about the quality of.
const DEV_MODEL = 'claude-haiku-4-5-20251001';

// Fields worth paying for a second, stronger-model call over — the
// actual usable recipe. Timing (activeTimeMinutes/totalTimeMinutes) and
// yield are useful but not mission-critical (developer decision,
// 2026-08-05): a recipe with fuzzy timing is still fully usable, so
// Sonnet flagging those alone isn't worth an Opus retry. suggestedCategories/
// suggestedTags are AI's own inference either way, not something a page
// "has" to get right.
const CRITICAL_FIELDS = new Set(['title', 'ingredientSections', 'instructionSections']);

/**
 * Heuristic for "the primary model's result looks unreliable, worth
 * paying for a stronger model instead of shipping this as-is": either it
 * came back with no actual ingredients/instructions at all (which is
 * either a genuinely content-free page — escalating won't help, but the
 * extra call is cheap insurance — or the model failing to find content a
 * stronger model might), or it flagged one of the mission-critical
 * fields itself as uncertain (AI-07/AI-08's own signal, reused rather
 * than inventing a second confidence mechanism). Uncertainty about
 * non-critical fields (timing, yield, suggested categories/tags) does
 * NOT trigger escalation on its own.
 */
function seemsUncertain(extraction: RecipeExtraction): boolean {
  const hasNoIngredients = extraction.ingredientSections.every(
    (section) => section.items.length === 0,
  );
  const hasNoInstructions = extraction.instructionSections.every(
    (section) => section.steps.length === 0,
  );
  const hasCriticalUncertainty = extraction.uncertainFields.some((field) =>
    CRITICAL_FIELDS.has(field),
  );
  return hasNoIngredients || hasNoInstructions || hasCriticalUncertainty;
}

// Anthropic's `messages` content accepts a plain string or an array of
// content blocks — generalized here (rather than staying pageText-only)
// so the image extraction path below can reuse the exact same call/parse/
// error-handling logic instead of duplicating it.
async function callModel(
  client: Anthropic,
  content: Anthropic.MessageParam['content'],
  model: string,
  systemPrompt: string,
): Promise<RecipeExtraction> {
  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
    output_config: {
      format: zodOutputFormat(RecipeExtractionSchema),
    },
  });

  if (response.parsed_output === null) {
    throw new Error(
      `Claude response did not match the recipe schema (stop_reason: ${response.stop_reason})`,
    );
  }

  return response.parsed_output;
}

export interface ExtractRecipeOptions {
  /**
   * Opts into the full Sonnet-primary/Opus-escalation strategy. Defaults
   * to false, which always uses the cheap single Haiku call instead
   * (see DEV_MODEL above) — the caller decides this from its own
   * deployment environment (e.g. the Edge Function reading
   * `Deno.env.get('APP_ENV') === 'production'`) rather than this file
   * knowing anything about *which* runtime or environment it's in, so it
   * stays plain, portable TS either way.
   */
  useProductionModels?: boolean;
}

export async function extractRecipe(
  client: Anthropic,
  pageText: string,
  categoryValues: string[],
  options: ExtractRecipeOptions = {},
): Promise<RecipeExtraction> {
  const systemPrompt = buildExtractionSystemPrompt(categoryValues);
  if (!options.useProductionModels) {
    return callModel(client, pageText, DEV_MODEL, systemPrompt);
  }

  const primaryResult = await callModel(client, pageText, PRIMARY_MODEL, systemPrompt);
  if (!seemsUncertain(primaryResult)) return primaryResult;

  return callModel(client, pageText, ESCALATION_MODEL, systemPrompt);
}

/**
 * Phase 10 (ADR-0017 decision 3): a photo's extraction quality depends on
 * real visual parsing (handwriting, glare, cropped edges, multi-column
 * layouts), where DEV_MODEL's weaker Haiku call is more likely to produce
 * exactly the confidently-wrong output AI-08 exists to prevent — so this
 * path floors at PRIMARY_MODEL (Sonnet) in every environment, dev
 * included, instead of reusing DEV_MODEL. The escalate-to-Opus-on-
 * uncertain-critical-fields decision itself (seemsUncertain, gated on
 * useProductionModels) is unchanged from the text path — only the floor
 * moved.
 */
export function buildImageExtractionSystemPrompt(categoryValues: string[]): string {
  return `You extract a single recipe from a photograph — a recipe card, a cookbook page, a handwritten note, or similar. The image may have glare, be partially cropped, show only part of a multi-page recipe, or be otherwise imperfect.

Rules:
- Rewrite instructions clearly and concisely; do not copy awkward phrasing verbatim, but do not invent steps that aren't legible in the photo either.
- Include each ingredient's quantity inline in its own item text (e.g. "2 cups flour", not a separate quantity field).
- Preserve the source's own section structure for ingredients and instructions when present; use a single unheaded section when there is none.
- If the photo shows only part of a recipe (e.g. ingredients but no instructions, or the image is cut off), extract what is genuinely legible and leave the rest empty — do not invent missing sections.
- Infer active time, total time, and yield only when legibly stated or clearly implied; do NOT invent a specific number you cannot support from the image.
- For any field you are not confident about — including anything illegible, ambiguous handwriting, or a guess at a partially-obscured word — still provide your best value (or null for numeric/yield fields), but add that field's name to uncertainFields. Never silently guess — flag it instead.
- suggestedCategories: infer from the recipe's content which of the following categories genuinely apply — choose zero or more, but ONLY from this exact list; never invent a category outside it: ${formatCategoryList(categoryValues)}.
- suggestedTags: your own free-form inference from the recipe's content, not necessarily anything stated explicitly in the photo. At most 3, short (one or two words), lowercase. Only tag a genuinely distinguishing, reusable attribute a cook would filter or search for later — diet, cuisine, technique, or occasion. Do not restate the title, an ingredient, or anything already captured in suggestedCategories, and do not invent a one-off descriptor so specific it wouldn't ever apply to another recipe. When in doubt, tag less.
- notes: null unless the photo shows its own explicit, clearly labeled aside — text actually headed "Tip," "Note," "Cook's Note," "Chef's Note," "Variation," or "Storage" (or an equivalent unmistakable label) — giving practical guidance about making, storing, or serving this dish. If present and legible, copy its substance concisely; do not pad it or guess at illegible portions. This is NOT a place to summarize the recipe or restate an instruction — if you are inferring or synthesizing rather than reading an explicit labeled aside, the answer is null. When in doubt, null.`;
}

export interface ExtractRecipeFromImageOptions {
  /** Same meaning as ExtractRecipeOptions.useProductionModels — opts into Opus escalation on an uncertain Sonnet result. Unlike the text path, the non-production floor is still Sonnet, not Haiku (see this function's own doc comment). */
  useProductionModels?: boolean;
}

export async function extractRecipeFromImage(
  client: Anthropic,
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  categoryValues: string[],
  options: ExtractRecipeFromImageOptions = {},
): Promise<RecipeExtraction> {
  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: imageBase64 },
    },
    { type: 'text', text: 'Extract the recipe shown in this photo.' },
  ];
  const systemPrompt = buildImageExtractionSystemPrompt(categoryValues);

  const primaryResult = await callModel(client, content, PRIMARY_MODEL, systemPrompt);
  if (!options.useProductionModels) return primaryResult;
  if (!seemsUncertain(primaryResult)) return primaryResult;

  return callModel(client, content, ESCALATION_MODEL, systemPrompt);
}
