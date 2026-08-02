import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

/**
 * Server-side only — never import this from src/ (the Expo/RN client
 * bundle). This is Phase 1's proof that Claude structured extraction
 * works; Phase 8 wires it into the real import pipeline (a Supabase Edge
 * Function, not this Node module directly — the schema/prompt design
 * carries over, the runtime host doesn't).
 *
 * Every field maps to an explicit PRD requirement so the schema itself
 * documents what it's for:
 *   title/activeTimeMinutes/totalTimeMinutes/yield -> REC-01
 *   ingredientSections                              -> REC-02
 *   instructionSections                              -> REC-03
 *   suggestedCategories/suggestedTags                -> AI-06 / ORG-04
 *   uncertainFields                                   -> AI-07, AI-08
 * No `description` field — prd.md REC-09 says that field must not exist.
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
    suggestedTags: z.array(z.string()),
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

export const EXTRACTION_SYSTEM_PROMPT = `You extract a single recipe from webpage text that has already been reduced to its main content — navigation, ads, comments, and unrelated blog narrative have been stripped before it reached you, but some may remain.

Rules:
- Remove any remaining blog narrative, life-story, or SEO filler — return only the recipe itself.
- Rewrite instructions clearly and concisely; do not copy awkward phrasing verbatim.
- Include each ingredient's quantity inline in its own item text (e.g. "2 cups flour", not a separate quantity field).
- Preserve the page's own section structure for ingredients and instructions (e.g. "For the sauce" / "For the crust") when present; use a single unheaded section when the page has no sections.
- Infer active time, total time, and yield when the page implies them even if not stated in exact numbers, but do NOT invent a specific number you cannot support from the text.
- For any field you are not confident about, still provide your best value (or null for numeric/yield fields), but add that field's name to uncertainFields. Never silently guess — flag it instead.
- suggestedCategories and suggestedTags are your inference from the recipe's content, not necessarily anything stated explicitly on the page.`;

export async function extractRecipe(
  client: Anthropic,
  pageText: string,
): Promise<RecipeExtraction> {
  const response = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: pageText }],
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
