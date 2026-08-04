import { getDatabase } from '../db/database';
import {
  buildEverythingMatchQuery,
  buildFuzzyMatchQuery,
  buildIngredientsMatchQuery,
  buildTitleMatchQuery,
  mergeTiers,
  type SearchRow,
} from './buildSearchQuery';

export interface SearchResult {
  id: string;
  title: string;
}

function toResults(rows: SearchRow[]): SearchResult[] {
  return rows.map((row) => ({ id: row.recipe_id, title: row.title }));
}

/**
 * SRCH-01..04: three strict priority tiers (title, then ingredients, then
 * everything else — ADR-0014), each internally ranked by bm25. Falls back
 * to the typo-tolerant trigram path (SRCH-03) only when every tier above
 * is empty — the fuzzy path is deliberately not the primary search, since
 * trigram-overlap ranking is much looser than bm25 and would surface
 * worse results first if used for every query.
 *
 * Not unit-tested here — this is a thin, mechanical wrapper around the
 * fully unit-tested query builders in buildSearchQuery.ts, plus the real
 * expo-sqlite native module, which Jest can't meaningfully exercise (see
 * docs/risk-spikes/sqlite-fts.md — why that's a real platform question,
 * not a logic one). Integration-verified via the dev client during the
 * Phase 1 spike and again this phase.
 */
export async function searchRecipes(query: string, limit = 20): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const db = await getDatabase();

  const title = buildTitleMatchQuery(trimmed, limit);
  const ingredients = buildIngredientsMatchQuery(trimmed, limit);
  const everything = buildEverythingMatchQuery(trimmed, limit);

  const [titleRows, ingredientRows, everythingRows] = await Promise.all([
    db.getAllAsync<SearchRow>(title.sql, title.params),
    db.getAllAsync<SearchRow>(ingredients.sql, ingredients.params),
    db.getAllAsync<SearchRow>(everything.sql, everything.params),
  ]);

  const merged = mergeTiers([titleRows, ingredientRows, everythingRows], limit);
  if (merged.length > 0) return toResults(merged);

  const fuzzy = buildFuzzyMatchQuery(trimmed, limit);
  const fuzzyRows = await db.getAllAsync<SearchRow>(fuzzy.sql, fuzzy.params);
  return toResults(fuzzyRows);
}
