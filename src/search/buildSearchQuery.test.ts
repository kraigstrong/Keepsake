import { buildRankedMatchQuery, buildFuzzyMatchQuery } from './buildSearchQuery';

describe('buildRankedMatchQuery', () => {
  it('quotes each word as its own FTS5 literal, ANDed', () => {
    const { params } = buildRankedMatchQuery('garlic onion');
    expect(params[0]).toBe('"garlic" "onion"');
  });

  it('escapes embedded double quotes so input can never break out into FTS5 syntax', () => {
    const { params } = buildRankedMatchQuery('NOT "evil" OR *');
    // Every word — including bare FTS5 operators like NOT/OR and the
    // prefix wildcard `*` — ends up quoted as literal text, not syntax.
    expect(params[0]).toBe('"NOT" """evil""" "OR" "*"');
  });

  it('column-weights title highest per SRCH-02, matching schema column order', () => {
    const { sql } = buildRankedMatchQuery('tomato');
    // title, ingredients, notes, author, source, categories, tags
    expect(sql).toContain('bm25(recipe_fts, 10, 5, 1, 1, 1, 3, 3)');
  });

  it('respects a custom limit', () => {
    const { sql } = buildRankedMatchQuery('tomato', 5);
    expect(sql).toContain('limit 5');
  });
});

describe('buildFuzzyMatchQuery', () => {
  it("produces an OR of the query's trigrams, not an AND", () => {
    const { params } = buildFuzzyMatchQuery('tomatto');
    expect(params[0]).toContain(' OR ');
    expect(params[0]).not.toContain(' AND ');
  });

  it('deduplicates repeated trigrams', () => {
    // "aaaa" -> trigrams "aaa", "aaa" (only one distinct trigram)
    const { params } = buildFuzzyMatchQuery('aaaa');
    const grams = params[0].split(' OR ');
    expect(grams).toEqual(['"aaa"']);
  });

  it('returns a guaranteed-empty query for input shorter than 3 characters', () => {
    const { sql, params } = buildFuzzyMatchQuery('to');
    expect(sql).toContain('where 0');
    expect(params).toEqual(['']);
  });
});
