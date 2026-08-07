import { getDatabase } from '../db/database';
import {
  buildEverythingMatchQuery,
  buildFuzzyMatchQuery,
  buildIngredientsMatchQuery,
  buildTitleMatchQuery,
  mergeTiers,
  type SearchRow,
} from './buildSearchQuery';
import { trackEvent } from '../observability';

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
 * The orchestration (tiering, fallback, telemetry) is unit tested with a
 * mocked database (search.test.ts) — the query SQL itself is fully unit
 * tested in buildSearchQuery.ts, and real FTS5 behavior against the
 * actual expo-sqlite native module, which Jest can't meaningfully
 * exercise, is verified via the dev client (docs/risk-spikes/sqlite-fts.md
 * and again this phase) plus a node:sqlite benchmark at realistic scale
 * (src/search/searchPerformance.bench.ts).
 *
 * Emits a search_performed timing event (duration + result count only —
 * never the raw query text, per this phase's "raw search terms excluded
 * from analytics by default" privacy requirement) so a real regression
 * at real-world library sizes is observable in production.
 */
export async function searchRecipes(
  query: string,
  householdId: string,
  limit = 20,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const startedAt = Date.now();
  const db = await getDatabase();

  const title = buildTitleMatchQuery(trimmed, householdId, limit);
  const ingredients = buildIngredientsMatchQuery(trimmed, householdId, limit);
  const everything = buildEverythingMatchQuery(trimmed, householdId, limit);

  const [titleRows, ingredientRows, everythingRows] = await Promise.all([
    db.getAllAsync<SearchRow>(title.sql, title.params),
    db.getAllAsync<SearchRow>(ingredients.sql, ingredients.params),
    db.getAllAsync<SearchRow>(everything.sql, everything.params),
  ]);

  const merged = mergeTiers([titleRows, ingredientRows, everythingRows], limit);
  let results: SearchResult[];
  if (merged.length > 0) {
    results = toResults(merged);
  } else {
    const fuzzy = buildFuzzyMatchQuery(trimmed, householdId, limit);
    const fuzzyRows = await db.getAllAsync<SearchRow>(fuzzy.sql, fuzzy.params);
    results = toResults(fuzzyRows);
  }

  trackEvent('search_performed', {
    durationMs: Date.now() - startedAt,
    resultCount: results.length,
  });
  return results;
}
