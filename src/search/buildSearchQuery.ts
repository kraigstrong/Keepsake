/**
 * Pure query-building (and result-merging) functions — no SQLite
 * dependency, fully unit testable. The actual DB calls live in search.ts,
 * a thin, separately-verified wrapper around these.
 *
 * SRCH-02 priority (title > ingredients > everything else) is a strict
 * tier, not a blended bm25 weight (ADR-0014) — the risk spike
 * (docs/risk-spikes/sqlite-fts.md) found that weighting bm25 columns
 * doesn't reliably rank title matches above ingredient matches, since
 * bm25's IDF term can dominate the weight multiplier. Instead, three
 * separate column-scoped MATCH queries are run and merged in tier order,
 * each internally ranked by bm25.
 */

export interface SearchRow {
  recipe_id: string;
  title: string;
  rank: number;
}

export interface TierMatchQuery {
  sql: string;
  params: [string];
}

/**
 * FTS5 column filter (`col:(...)`) restricts the match to one column
 * while still using porter-stemmed matching (SRCH-04 singular/plural),
 * ranked by bm25 within that column alone.
 */
function buildColumnMatchQuery(column: string, query: string, limit: number): TierMatchQuery {
  return {
    sql: `
      select recipe_id, title, bm25(recipe_fts) as rank
        from recipe_fts
       where recipe_fts match ?
       order by rank
       limit ${limit}
    `,
    params: [`${column}:(${toFts5MatchLiteral(query)})`],
  };
}

export function buildTitleMatchQuery(query: string, limit = 20): TierMatchQuery {
  return buildColumnMatchQuery('title', query, limit);
}

export function buildIngredientsMatchQuery(query: string, limit = 20): TierMatchQuery {
  return buildColumnMatchQuery('ingredients', query, limit);
}

/** Tier 3: any column at all (notes, source, categories, tags, plus title/ingredients again — duplicates are dropped by mergeTiers). */
export function buildEverythingMatchQuery(query: string, limit = 20): TierMatchQuery {
  return {
    sql: `
      select recipe_id, title, bm25(recipe_fts) as rank
        from recipe_fts
       where recipe_fts match ?
       order by rank
       limit ${limit}
    `,
    params: [toFts5MatchLiteral(query)],
  };
}

/**
 * Concatenates tiers in priority order, dropping a row from a later tier
 * if an earlier tier already surfaced the same recipe (title match, then
 * ingredients match elsewhere in the same recipe, then a categories/tags/
 * notes-only match), then truncates to limit. Each input array is assumed
 * already bm25-ordered within itself (the tier queries above do this).
 */
export function mergeTiers(tiers: SearchRow[][], limit = 20): SearchRow[] {
  const seen = new Set<string>();
  const merged: SearchRow[] = [];

  for (const tier of tiers) {
    for (const row of tier) {
      if (seen.has(row.recipe_id)) continue;
      seen.add(row.recipe_id);
      merged.push(row);
      if (merged.length >= limit) return merged;
    }
  }

  return merged;
}

export interface FuzzyMatchQuery {
  sql: string;
  params: [string];
}

/**
 * Typo-tolerant fallback (SRCH-03) — only meaningful when every tier
 * above returns zero rows; a trigram OR-query is intentionally loose and
 * would rank poorly-relevant results ahead of good ones if used as the
 * primary path. Title only (recipe_trigram's one indexed column) — the
 * highest-value tier to still surface on a typo. Validated: FTS5's own
 * trigram tokenizer with a normal MATCH query does NOT tolerate typos (a
 * query is itself trigram-tokenized and ANDed, so a single-character typo
 * still fails to match) — this works by OR-ing the query's trigrams
 * together instead, then ranking by how many distinct trigrams a
 * candidate shares with the query.
 */
export function buildFuzzyMatchQuery(query: string, limit = 20): FuzzyMatchQuery {
  const grams = [...new Set(trigramsOf(query.toLowerCase()))];
  // Guard: FTS5 has no useful trigram signal below 3 characters — the
  // caller should treat this as "no fuzzy fallback available" rather than
  // running a query that matches everything or nothing meaningfully.
  if (grams.length === 0) {
    return {
      sql: `select recipe_id, title, 0 as shared from recipe_trigram where 0`,
      params: [''],
    };
  }
  const orExpr = grams.map((g) => JSON.stringify(g)).join(' OR ');
  return {
    sql: `
      select recipe_id, title, count(*) as shared
        from recipe_trigram
       where recipe_trigram match ?
       group by recipe_id
       order by shared desc
       limit ${limit}
    `,
    params: [orExpr],
  };
}

function trigramsOf(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
  return out;
}

/**
 * Splits on whitespace and quotes each word as its own FTS5 string literal
 * (doubling embedded `"`), joined with implicit AND. This is the untrusted-
 * input boundary — without per-word quoting, a search box is an FTS5
 * query-syntax injection point (raw input can contain `AND`/`OR`/`NOT`,
 * `NEAR`, `col:` filters, `-exclude`, `*prefix`). Quoting the *whole*
 * query as one literal would be equally safe but changes multi-word
 * search from "all these words, any order" to "this exact phrase" — not
 * what SRCH-01 implies. Per-word quoting keeps AND-of-terms semantics
 * while still treating every word as literal text, never syntax.
 */
function toFts5MatchLiteral(query: string): string {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '""';
  return words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' ');
}
