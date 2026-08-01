/**
 * Pure query-building functions — no SQLite dependency, fully unit
 * testable. The actual DB calls live in search.ts, which is a thin,
 * separately-verified wrapper around these.
 */

// Priority per SRCH-02: title > ingredients > everything else. Position
// matches recipe_fts's declared column order in schema.ts exactly.
const BM25_COLUMN_WEIGHTS = [10.0, 5.0, 1.0, 1.0, 1.0, 3.0, 3.0] as const;

export interface RankedMatchQuery {
  sql: string;
  params: [string];
}

/**
 * FTS5 exact/stemmed match (porter unicode61 — handles singular/plural per
 * SRCH-04) ranked by column-weighted bm25. Escapes the query as an FTS5
 * string literal so user input can't break out into FTS5 query syntax
 * (column filters, NOT/OR operators, etc.) — untrusted input per prd.md §30.
 */
export function buildRankedMatchQuery(query: string, limit = 20): RankedMatchQuery {
  const weights = BM25_COLUMN_WEIGHTS.join(', ');
  return {
    sql: `
      select r.id, r.title,
             bm25(recipe_fts, ${weights}) as rank
        from recipe_fts
        join recipe r on r.id = recipe_fts.rowid
       where recipe_fts match ?
       order by rank
       limit ${limit}
    `,
    params: [toFts5MatchLiteral(query)],
  };
}

export interface FuzzyMatchQuery {
  sql: string;
  params: [string];
}

/**
 * Typo-tolerant fallback (SRCH-03) — only meaningful when the exact/stemmed
 * match above returns zero rows; a trigram OR-query is intentionally loose
 * and would rank poorly-relevant results ahead of good ones if used as the
 * primary path. Validated: FTS5's own trigram tokenizer with a normal
 * MATCH query does NOT tolerate typos (a query is itself trigram-tokenized
 * and ANDed, so a single-character typo still fails to match) — this
 * works by OR-ing the query's trigrams together instead, then ranking by
 * how many distinct trigrams a candidate shares with the query.
 */
export function buildFuzzyMatchQuery(query: string, limit = 20): FuzzyMatchQuery {
  const grams = [...new Set(trigramsOf(query.toLowerCase()))];
  // Guard: FTS5 has no useful trigram signal below 3 characters — the
  // caller should treat this as "no fuzzy fallback available" rather than
  // running a query that matches everything or nothing meaningfully.
  if (grams.length === 0) {
    return { sql: `select r.id, r.title, 0 as shared from recipe r where 0`, params: [''] };
  }
  const orExpr = grams.map((g) => JSON.stringify(g)).join(' OR ');
  return {
    sql: `
      select r.id, r.title, count(*) as shared
        from (select rowid from recipe_trigram where recipe_trigram match ?) m
        join recipe r on r.id = m.rowid
       group by r.id
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
