/**
 * Phase 1 risk-spike schema — proves the FTS5 pattern SRCH-01..05 (Phase 7)
 * will build on. Not the real recipe schema (that's Phase 4); column names
 * here are deliberately close to what Phase 4/7 will actually need so the
 * spike's findings transfer directly.
 *
 * Column order matters — buildRankedMatchQuery()'s bm25() weights are
 * positional against this exact order (title, ingredients, notes, author,
 * source, categories, tags). Changing this order without updating the
 * weight array silently misweights ranking.
 */
export const CREATE_SEARCH_SCHEMA_SQL = `
  create table if not exists recipe (
    id integer primary key,
    title text not null,
    ingredients text not null,
    notes text not null default '',
    author text not null default '',
    source text not null default '',
    categories text not null default '',
    tags text not null default ''
  );

  create virtual table if not exists recipe_fts using fts5(
    title, ingredients, notes, author, source, categories, tags,
    content='recipe', content_rowid='id',
    tokenize='porter unicode61'
  );

  create trigger if not exists recipe_ai after insert on recipe begin
    insert into recipe_fts(rowid, title, ingredients, notes, author, source, categories, tags)
    values (new.id, new.title, new.ingredients, new.notes, new.author, new.source, new.categories, new.tags);
  end;

  -- Separate trigram index for the typo-tolerant fallback path — see
  -- buildFuzzyMatchQuery(). FTS5's own MATCH is an implicit AND over
  -- query trigrams, which does NOT tolerate typos (validated: a query
  -- trigram-tokenized the same way still fails to match a 1-character
  -- typo). The fallback works by OR-ing trigrams instead.
  create virtual table if not exists recipe_trigram using fts5(
    title, content='recipe', content_rowid='id', tokenize='trigram'
  );

  create trigger if not exists recipe_ai_trigram after insert on recipe begin
    insert into recipe_trigram(rowid, title) values (new.id, new.title);
  end;
`;
