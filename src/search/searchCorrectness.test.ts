import { DatabaseSync } from 'node:sqlite';

import {
  buildEverythingMatchQuery,
  buildIngredientsMatchQuery,
  buildTitleMatchQuery,
  mergeTiers,
  type SearchRow,
  type TierMatchQuery,
} from './buildSearchQuery';
import { MIGRATIONS } from '../db/schema';

/**
 * Correctness against the real schema/tokenizer, not just query-building
 * logic (buildSearchQuery.test.ts) or performance at scale
 * (searchPerformance.test.ts). Specifically guards execution-plan.md's
 * "Exact titles are not findable" High-severity release-blocking defect
 * — a plausible regression risk given this phase's move from blended
 * bm25 weights to strict per-column tiering (ADR-0014). Same node:sqlite
 * methodology as the other search test files.
 *
 * ADR-0020 (Phase 11.5): the tier queries now join recipe_fts back to
 * recipes for household scoping, so this file also creates a matching
 * `recipes` row per fixture (migration 1, not just migration 2's FTS
 * tables) and has one dedicated cross-household test proving the join
 * actually excludes another household's row, not just that same-
 * household search still works.
 *
 * ADR-0025 (Phase 16): the same join also excludes archived/deleted
 * recipes now, so migration 11 (archived_at/deleted_at) runs here too —
 * not every migration in between, only the ones this file's queries
 * actually touch.
 */

const HOUSEHOLD_ID = 'hh-search-correctness';

function createSearchDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const statement of MIGRATIONS[1]!) db.exec(statement);
  for (const statement of MIGRATIONS[2]!) db.exec(statement);
  for (const statement of MIGRATIONS[11]!) db.exec(statement);
  return db;
}

function insertRecipe(
  db: DatabaseSync,
  row: {
    recipeId: string;
    title: string;
    householdId?: string;
    ingredients?: string;
    notes?: string;
    sourceAttribution?: string;
    sourceUrl?: string;
    categories?: string;
    tags?: string;
  },
): void {
  const householdId = row.householdId ?? HOUSEHOLD_ID;

  db.prepare(
    `insert into recipes
       (id, household_id, version, title, tags, category_ids, ingredient_sections,
        instruction_sections, updated_at, synced_at)
     values (?, ?, 1, ?, '[]', '[]', '[]', '[]', '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z')`,
  ).run(row.recipeId, householdId, row.title);

  db.prepare(
    `insert into recipe_fts
       (recipe_id, title, ingredients, notes, source_attribution, source_url, categories, tags)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.recipeId,
    row.title,
    row.ingredients ?? '',
    row.notes ?? '',
    row.sourceAttribution ?? '',
    row.sourceUrl ?? '',
    row.categories ?? '',
    row.tags ?? '',
  );
}

function runTierQuery(db: DatabaseSync, query: TierMatchQuery): SearchRow[] {
  return db.prepare(query.sql).all(...query.params) as unknown as SearchRow[];
}

function searchIds(db: DatabaseSync, query: string, householdId = HOUSEHOLD_ID): string[] {
  const merged = mergeTiers([
    runTierQuery(db, buildTitleMatchQuery(query, householdId)),
    runTierQuery(db, buildIngredientsMatchQuery(query, householdId)),
    runTierQuery(db, buildEverythingMatchQuery(query, householdId)),
  ]);
  return merged.map((row) => row.recipe_id);
}

describe('search correctness against the real schema and tokenizer', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = createSearchDatabase();
  });

  it('finds a recipe by its exact, full multi-word title', () => {
    insertRecipe(db, { recipeId: 'r1', title: 'Grandma Herb Roast Chicken' });
    insertRecipe(db, { recipeId: 'r2', title: 'Weeknight Beef Tacos' });

    expect(searchIds(db, 'Grandma Herb Roast Chicken')).toEqual(['r1']);
  });

  it('finds a recipe by a plural query against a singular title word (SRCH-04)', () => {
    insertRecipe(db, { recipeId: 'r1', title: 'Roast Chicken' });

    expect(searchIds(db, 'Chickens')).toContain('r1');
  });

  it('finds a recipe by a singular query against a plural title word (SRCH-04)', () => {
    insertRecipe(db, { recipeId: 'r1', title: 'Beef Tacos' });

    expect(searchIds(db, 'Taco')).toContain('r1');
  });

  it('ranks a title match ahead of an ingredients-only match for the same query (SRCH-02)', () => {
    insertRecipe(db, {
      recipeId: 'ingredient-only',
      title: 'Weeknight Dinner',
      ingredients: 'basil',
    });
    insertRecipe(db, { recipeId: 'title-match', title: 'Basil Pesto', ingredients: 'pine nuts' });

    expect(searchIds(db, 'basil')).toEqual(['title-match', 'ingredient-only']);
  });

  it('finds a recipe by its source attribution, not just title/ingredients', () => {
    insertRecipe(db, { recipeId: 'r1', title: 'Roast Chicken', sourceAttribution: 'Grandma' });

    expect(searchIds(db, 'Grandma')).toContain('r1');
  });

  it('finds a recipe by category or tag text', () => {
    insertRecipe(db, {
      recipeId: 'r1',
      title: 'Roast Chicken',
      categories: 'Chicken',
      tags: 'weeknight',
    });

    expect(searchIds(db, 'weeknight')).toContain('r1');
  });

  it('ADR-0020: excludes a recipe_fts row belonging to a different household, even on an otherwise-matching title', () => {
    insertRecipe(db, {
      recipeId: 'other-household',
      title: 'Grandma Herb Roast Chicken',
      householdId: 'hh-someone-else',
    });

    expect(searchIds(db, 'Grandma Herb Roast Chicken')).toEqual([]);
    expect(searchIds(db, 'Grandma Herb Roast Chicken', 'hh-someone-else')).toEqual([
      'other-household',
    ]);
  });
});
