import * as SQLite from 'expo-sqlite';

import { buildFuzzyMatchQuery, buildRankedMatchQuery } from './buildSearchQuery';
import { CREATE_SEARCH_SCHEMA_SQL } from './schema';

export interface SearchResult {
  id: number;
  title: string;
}

/**
 * Not unit-tested here — this is a thin, mechanical wrapper around
 * buildRankedMatchQuery/buildFuzzyMatchQuery (both fully unit-tested in
 * buildSearchQuery.test.ts) plus the real expo-sqlite native module, which
 * Jest can't meaningfully exercise (see docs/risk-spikes/sqlite-fts.md —
 * why that's a real platform question, not a logic one). Integration-
 * verified via the dev client on Simulator during the Phase 1 spike.
 */
export async function openSearchDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('keepsake.db');
  await db.execAsync(CREATE_SEARCH_SCHEMA_SQL);
  return db;
}

/**
 * SRCH-01..04: exact/stemmed match first (fast, well-ranked per SRCH-02).
 * Falls back to the typo-tolerant trigram path (SRCH-03) only when the
 * exact path finds nothing — the fuzzy path is deliberately not the
 * primary search, since trigram-overlap ranking is much looser than bm25
 * and would surface worse results first if used for every query.
 */
export async function searchRecipes(
  db: SQLite.SQLiteDatabase,
  query: string,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const exact = buildRankedMatchQuery(trimmed);
  const exactRows = await db.getAllAsync<SearchResult>(exact.sql, exact.params);
  if (exactRows.length > 0) return exactRows;

  const fuzzy = buildFuzzyMatchQuery(trimmed);
  return db.getAllAsync<SearchResult>(fuzzy.sql, fuzzy.params);
}
