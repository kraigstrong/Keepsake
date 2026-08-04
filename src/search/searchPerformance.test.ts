import { DatabaseSync } from 'node:sqlite';

import {
  buildEverythingMatchQuery,
  buildFuzzyMatchQuery,
  buildIngredientsMatchQuery,
  buildTitleMatchQuery,
  mergeTiers,
  type SearchRow,
  type TierMatchQuery,
} from './buildSearchQuery';
import { MIGRATIONS } from '../db/schema';

/**
 * Real-scale search performance, per the phase's "100/1,000/5,000 recipe
 * performance tests" validation requirement. Runs against Node's built-in
 * node:sqlite rather than a real device — legitimate for the same reason
 * as the Phase 1 risk spike (docs/risk-spikes/sqlite-fts.md): FTS5/
 * porter/trigram/bm25 *behavior and performance* are core SQLite
 * extension code, not iOS-platform-specific, and Jest can't exercise the
 * real expo-sqlite native module at all. Uses the actual production
 * schema (db/schema.ts's migration 2) and the actual query builders
 * (buildSearchQuery.ts) — not a synthetic stand-in query.
 */

const TITLE_WORDS = [
  'Roasted',
  'Grilled',
  'Spicy',
  'Creamy',
  'Baked',
  'Tomato',
  'Chicken',
  'Beef',
  'Garlic',
  'Lemon',
  'Herb',
  'Soup',
  'Stew',
  'Salad',
  'Pasta',
];
const INGREDIENT_WORDS = [
  'tomato',
  'onion',
  'garlic',
  'chicken',
  'beef',
  'salt',
  'pepper',
  'olive oil',
  'basil',
  'cheese',
  'flour',
  'butter',
  'lemon',
  'thyme',
  'cream',
];
const TAGS = ['weeknight', 'freezer-friendly', 'spicy', 'vegetarian', 'kid-friendly'];

function pick<T>(words: readonly T[], n: number): T {
  return words[n % words.length]!;
}

function createSearchDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const statement of MIGRATIONS[2]!) db.exec(statement);
  return db;
}

// Deterministic, not Math.random() — a flaky perf test that occasionally
// generates an unrealistic corpus (e.g. every recipe identical) would be
// worse than no test. Every recipe mentions "tomato" via INGREDIENT_WORDS'
// cycle, matching the risk spike's own worst case: a query term common
// across the whole corpus, where bm25's IDF term is least helpful.
function seedRecipes(db: DatabaseSync, count: number): void {
  const insertFts = db.prepare(
    `insert into recipe_fts
       (recipe_id, title, ingredients, notes, source_attribution, source_url, categories, tags)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertTrigram = db.prepare('insert into recipe_trigram (recipe_id, title) values (?, ?)');

  for (let i = 0; i < count; i++) {
    const title = `${pick(TITLE_WORDS, i)} ${pick(TITLE_WORDS, i + 7)} ${pick(TITLE_WORDS, i + 13)}`;
    const ingredients = Array.from({ length: 8 }, (_, j) => pick(INGREDIENT_WORDS, i + j)).join(
      ' ',
    );
    const tags = `${pick(TAGS, i)} ${pick(TAGS, i + 2)}`;
    insertFts.run(`r${i}`, title, ingredients, '', '', '', '', tags);
    insertTrigram.run(`r${i}`, title);
  }
}

function runTierQuery(db: DatabaseSync, query: TierMatchQuery): SearchRow[] {
  return db.prepare(query.sql).all(...query.params) as unknown as SearchRow[];
}

// Generous relative to the risk spike's observed sub-1ms queries at 2,004
// recipes — headroom for CI runner variance, not a tight regression gate.
const MAX_QUERY_MS = 200;

describe.each([100, 1000, 5000])('search performance at %i recipes', (count) => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = createSearchDatabase();
    seedRecipes(db, count);
  });

  it('runs the full tiered query (title, ingredients, everything, merge) within budget', () => {
    const startedAt = Date.now();

    const title = runTierQuery(db, buildTitleMatchQuery('tomato'));
    const ingredients = runTierQuery(db, buildIngredientsMatchQuery('tomato'));
    const everything = runTierQuery(db, buildEverythingMatchQuery('tomato'));
    const merged = mergeTiers([title, ingredients, everything]);

    const durationMs = Date.now() - startedAt;

    expect(merged.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(MAX_QUERY_MS);
  });

  it('runs the typo-tolerant fuzzy fallback within budget', () => {
    const startedAt = Date.now();

    const fuzzy = runTierQuery(db, buildFuzzyMatchQuery('tomatto'));

    const durationMs = Date.now() - startedAt;

    expect(fuzzy.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(MAX_QUERY_MS);
  });
});
