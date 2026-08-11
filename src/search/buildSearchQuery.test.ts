import {
  buildEverythingMatchQuery,
  buildFuzzyMatchQuery,
  buildIngredientsMatchQuery,
  buildTitleMatchQuery,
  mergeTiers,
  type SearchRow,
} from './buildSearchQuery';

const HOUSEHOLD_ID = 'hh1';

describe('buildTitleMatchQuery / buildIngredientsMatchQuery', () => {
  it('quotes each word as its own FTS5 literal, ANDed, scoped to the title column', () => {
    const { params } = buildTitleMatchQuery('garlic onion', HOUSEHOLD_ID);
    expect(params[0]).toBe('title:("garlic" "onion")');
  });

  it('scopes to the ingredients column', () => {
    const { params } = buildIngredientsMatchQuery('garlic', HOUSEHOLD_ID);
    expect(params[0]).toBe('ingredients:("garlic")');
  });

  it('escapes embedded double quotes so input can never break out into FTS5 syntax', () => {
    const { params } = buildTitleMatchQuery('NOT "evil" OR *', HOUSEHOLD_ID);
    // Every word — including bare FTS5 operators like NOT/OR and the
    // prefix wildcard `*` — ends up quoted as literal text, not syntax.
    expect(params[0]).toBe('title:("NOT" """evil""" "OR" "*")');
  });

  it('scopes the household id as the second bind param, ADR-0020', () => {
    const { params } = buildTitleMatchQuery('tomato', HOUSEHOLD_ID);
    expect(params[1]).toBe(HOUSEHOLD_ID);
  });

  it('joins against recipes and filters by household_id', () => {
    const { sql } = buildTitleMatchQuery('tomato', HOUSEHOLD_ID);
    expect(sql).toContain('join recipes r on r.id = t.recipe_id');
    expect(sql).toContain('r.household_id = ?');
  });

  it('excludes archived and deleted recipes (Phase 16, ADR-0025)', () => {
    const { sql } = buildTitleMatchQuery('tomato', HOUSEHOLD_ID);
    expect(sql).toContain('r.archived_at is null');
    expect(sql).toContain('r.deleted_at is null');
  });

  it('respects a custom limit', () => {
    const { sql } = buildTitleMatchQuery('tomato', HOUSEHOLD_ID, 5);
    expect(sql).toContain('limit 5');
  });

  it('ranks by bm25 with no column weighting (tiering handles priority, not weights)', () => {
    const { sql } = buildTitleMatchQuery('tomato', HOUSEHOLD_ID);
    expect(sql).toContain('bm25(recipe_fts)');
  });
});

describe('buildEverythingMatchQuery', () => {
  it('is not column-scoped', () => {
    const { params } = buildEverythingMatchQuery('tomato', HOUSEHOLD_ID);
    expect(params[0]).toBe('"tomato"');
  });

  it('excludes archived and deleted recipes (Phase 16, ADR-0025)', () => {
    const { sql } = buildEverythingMatchQuery('tomato', HOUSEHOLD_ID);
    expect(sql).toContain('r.archived_at is null');
    expect(sql).toContain('r.deleted_at is null');
  });
});

describe('mergeTiers', () => {
  const row = (id: string, rank = 0): SearchRow => ({ recipe_id: id, title: id, rank });

  it('concatenates tiers in priority order', () => {
    const merged = mergeTiers([[row('title-match')], [row('ingredient-match')]]);
    expect(merged.map((r) => r.recipe_id)).toEqual(['title-match', 'ingredient-match']);
  });

  it('drops a later-tier row already surfaced by an earlier tier', () => {
    const merged = mergeTiers([[row('a')], [row('a'), row('b')]]);
    expect(merged.map((r) => r.recipe_id)).toEqual(['a', 'b']);
  });

  it('truncates to the limit across tiers', () => {
    const merged = mergeTiers([[row('a'), row('b')], [row('c')]], 2);
    expect(merged.map((r) => r.recipe_id)).toEqual(['a', 'b']);
  });
});

describe('buildFuzzyMatchQuery', () => {
  it("produces an OR of the query's trigrams, not an AND", () => {
    const { params } = buildFuzzyMatchQuery('tomatto', HOUSEHOLD_ID);
    expect(params[0]).toContain(' OR ');
    expect(params[0]).not.toContain(' AND ');
  });

  it('scopes the household id as the second bind param, ADR-0020', () => {
    const { params } = buildFuzzyMatchQuery('tomatto', HOUSEHOLD_ID);
    expect(params[1]).toBe(HOUSEHOLD_ID);
  });

  it('joins against recipes and filters by household_id', () => {
    const { sql } = buildFuzzyMatchQuery('tomatto', HOUSEHOLD_ID);
    expect(sql).toContain('join recipes r on r.id = t.recipe_id');
    expect(sql).toContain('r.household_id = ?');
  });

  it('excludes archived and deleted recipes (Phase 16, ADR-0025)', () => {
    const { sql } = buildFuzzyMatchQuery('tomatto', HOUSEHOLD_ID);
    expect(sql).toContain('r.archived_at is null');
    expect(sql).toContain('r.deleted_at is null');
  });

  it('deduplicates repeated trigrams', () => {
    // "aaaa" -> trigrams "aaa", "aaa" (only one distinct trigram)
    const { params } = buildFuzzyMatchQuery('aaaa', HOUSEHOLD_ID);
    const grams = params[0]!.split(' OR ');
    expect(grams).toEqual(['"aaa"']);
  });

  it('returns a guaranteed-empty, parameter-free query for input shorter than 3 characters', () => {
    const { sql, params } = buildFuzzyMatchQuery('to', HOUSEHOLD_ID);
    expect(sql).toContain('where 0');
    expect(params).toEqual([]);
  });
});
