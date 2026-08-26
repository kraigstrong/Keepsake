import * as fs from 'fs';
import * as path from 'path';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildCandidateSnapshots,
  fetchRecentDeckAppearances,
  fetchThisWeekTagsAndCategoryKeys,
  mostRecentIso,
} from './fetchCandidateScoringInput';
import { scoreCandidates } from './scoreCandidates';

type QueryResult = { data: unknown; error: { message: string } | null };

// Mirrors every method the real Postgrest builder chain uses across this
// module (select/in/eq/neq/order/limit) as a no-op that returns itself,
// then resolves to `result` once awaited — same "thenable chain" idea as
// src/smartSelection/api.test.ts's mockActiveRoundLookup, generalized
// since this module's chains vary in shape per query.
function makeChain(result: QueryResult) {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['select', 'in', 'eq', 'neq', 'order', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  (chain as unknown as { then: (resolve: (r: QueryResult) => void) => void }).then = (resolve) =>
    resolve(result);
  return chain;
}

// One result per table name for tests where each table is queried at
// most once; `.from()` on any other table throws, so a query this module
// wasn't supposed to issue (e.g. skipping the early-return guards) fails
// the test loudly rather than silently returning undefined data.
function makeSupabaseMock(resultsByTable: Record<string, QueryResult>): SupabaseClient {
  const from = jest.fn((table: string) => {
    const result = resultsByTable[table];
    if (!result) throw new Error(`Test did not stub table "${table}"`);
    return makeChain(result);
  });
  return { from } as unknown as SupabaseClient;
}

describe('mostRecentIso', () => {
  it('returns null when both are null', () => {
    expect(mostRecentIso(null, null)).toBeNull();
  });

  it('returns whichever side is non-null when the other is null', () => {
    expect(mostRecentIso('2026-08-01T00:00:00Z', null)).toBe('2026-08-01T00:00:00Z');
    expect(mostRecentIso(null, '2026-08-01T00:00:00Z')).toBe('2026-08-01T00:00:00Z');
  });

  it('returns the chronologically later timestamp when both are present', () => {
    expect(mostRecentIso('2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z')).toBe(
      '2026-08-10T00:00:00Z',
    );
    expect(mostRecentIso('2026-08-10T00:00:00Z', '2026-08-01T00:00:00Z')).toBe(
      '2026-08-10T00:00:00Z',
    );
  });
});

describe('fetchRecentDeckAppearances', () => {
  it('returns an empty map and skips the candidate-row read when there are zero prior rounds', async () => {
    // Only 'selection_rounds' is stubbed — if the code queried
    // selection_round_candidates anyway despite an empty prior-round
    // list, makeSupabaseMock's from() would throw "Test did not stub
    // table", failing this test.
    const supabase = makeSupabaseMock({
      selection_rounds: { data: [], error: null },
    });

    const result = await fetchRecentDeckAppearances(supabase, ['recipe-a'], 'round-current');

    expect(result.size).toBe(0);
  });

  it('counts a single prior round correctly', async () => {
    const supabase = makeSupabaseMock({
      selection_rounds: { data: [{ id: 'round-prev-1' }], error: null },
      selection_round_candidates: { data: [{ recipe_id: 'recipe-a' }], error: null },
    });

    const result = await fetchRecentDeckAppearances(
      supabase,
      ['recipe-a', 'recipe-b'],
      'round-current',
    );

    expect(result.get('recipe-a')).toBe(1);
    expect(result.has('recipe-b')).toBe(false);
  });

  it('counts up to two prior rounds, per-recipe', async () => {
    const supabase = makeSupabaseMock({
      selection_rounds: {
        data: [{ id: 'round-prev-2' }, { id: 'round-prev-1' }],
        error: null,
      },
      // unique(round_id, recipe_id) means one row per (round, recipe) —
      // recipe-a appeared in both prior rounds, recipe-b in one, recipe-c
      // in neither.
      selection_round_candidates: {
        data: [{ recipe_id: 'recipe-a' }, { recipe_id: 'recipe-a' }, { recipe_id: 'recipe-b' }],
        error: null,
      },
    });

    const result = await fetchRecentDeckAppearances(
      supabase,
      ['recipe-a', 'recipe-b', 'recipe-c'],
      'round-current',
    );

    expect(result.get('recipe-a')).toBe(2);
    expect(result.get('recipe-b')).toBe(1);
    expect(result.has('recipe-c')).toBe(false);
  });

  it('excludes the round just created from the prior-round lookup', async () => {
    const neqSpy = jest.fn();
    const supabase = makeSupabaseMock({
      selection_rounds: { data: [], error: null },
    });
    // Intercept the chain's neq call to assert its argument.
    (supabase.from as jest.Mock).mockImplementationOnce(() => {
      const chain = makeChain({ data: [], error: null });
      chain.neq = jest.fn((...args: unknown[]) => {
        neqSpy(...args);
        return chain;
      });
      return chain;
    });

    await fetchRecentDeckAppearances(supabase, ['recipe-a'], 'round-current');

    expect(neqSpy).toHaveBeenCalledWith('id', 'round-current');
  });
});

describe('fetchThisWeekTagsAndCategoryKeys', () => {
  it('returns empty arrays without querying when there are no This Week recipes', async () => {
    const from = jest.fn(() => {
      throw new Error('should not query when thisWeekRecipeIds is empty');
    });
    const supabase = { from } as unknown as SupabaseClient;

    const result = await fetchThisWeekTagsAndCategoryKeys(supabase, []);

    expect(result).toEqual({ tags: [], categoryKeys: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it('flattens tags and qualifies category keys across all This Week recipes', async () => {
    const supabase = makeSupabaseMock({
      recipes: {
        data: [
          { id: 'w1', tags: ['comfort'], planned_count: 1 },
          { id: 'w2', tags: ['comfort', 'soup'], planned_count: 0 },
        ],
        error: null,
      },
      recipe_categories: {
        data: [{ recipe_id: 'w1', categories: { group_name: 'dish_type', value: 'Soup' } }],
        error: null,
      },
    });

    const result = await fetchThisWeekTagsAndCategoryKeys(supabase, ['w1', 'w2']);

    expect(result.tags).toEqual(['comfort', 'comfort', 'soup']);
    expect(result.categoryKeys).toEqual(['dish_type:Soup']);
  });
});

describe('buildCandidateSnapshots', () => {
  // r1: cooked but never formally planned (neverPlanned=true; lastActivityAt
  //     from cooking_events alone).
  // r2: planned twice, also cooked once earlier (lastActivityAt = the more
  //     recent planning_entries.created_at, not the older cooking_events
  //     row) — no tags/categories at all.
  // r3: no planning or cooking history at all (lastActivityAt=null).
  const supabase = makeSupabaseMock({
    recipes: {
      data: [
        { id: 'r1', tags: ['quick', 'vegetarian'], planned_count: 5 },
        { id: 'r2', tags: [], planned_count: 0 },
        { id: 'r3', tags: ['spicy'], planned_count: 2 },
      ],
      error: null,
    },
    recipe_categories: {
      data: [
        { recipe_id: 'r1', categories: { group_name: 'protein', value: 'Vegetarian' } },
        { recipe_id: 'r3', categories: { group_name: 'dish_type', value: 'Soup' } },
      ],
      error: null,
    },
    planning_entries: {
      data: [
        { recipe_id: 'r2', created_at: '2026-08-01T00:00:00Z' },
        { recipe_id: 'r2', created_at: '2026-08-10T00:00:00Z' },
      ],
      error: null,
    },
    cooking_events: {
      data: [
        { recipe_id: 'r1', cooked_at: '2026-08-20T00:00:00Z' },
        { recipe_id: 'r2', cooked_at: '2026-08-05T00:00:00Z' },
      ],
      error: null,
    },
    selection_rounds: { data: [], error: null },
  });

  it('builds a correct snapshot per recipe', async () => {
    const snapshots = await buildCandidateSnapshots(supabase, ['r1', 'r2', 'r3'], 'round-current');
    const byId = new Map(snapshots.map((s) => [s.recipeId, s]));

    expect(byId.get('r1')).toEqual({
      recipeId: 'r1',
      tags: ['quick', 'vegetarian'],
      categoryKeys: ['protein:Vegetarian'],
      neverPlanned: true,
      lastActivityAt: '2026-08-20T00:00:00Z',
      plannedCount: 5,
      recentDeckAppearances: 0,
    });

    expect(byId.get('r2')).toEqual({
      recipeId: 'r2',
      tags: [],
      categoryKeys: [],
      neverPlanned: false,
      lastActivityAt: '2026-08-10T00:00:00Z', // planned (Aug 10) beats cooked (Aug 5)
      plannedCount: 0,
      recentDeckAppearances: 0,
    });

    expect(byId.get('r3')).toEqual({
      recipeId: 'r3',
      tags: ['spicy'],
      categoryKeys: ['dish_type:Soup'],
      neverPlanned: true,
      lastActivityAt: null,
      plannedCount: 2,
      recentDeckAppearances: 0,
    });
  });
});

describe('wiring produces real scores, not placeholders', () => {
  it('scoreCandidates fed real snapshots yields non-zero scores and non-empty reason codes', async () => {
    const supabase = makeSupabaseMock({
      recipes: {
        data: [
          { id: 'r1', tags: ['quick'], planned_count: 0 },
          { id: 'r2', tags: ['soup'], planned_count: 3 },
        ],
        error: null,
      },
      recipe_categories: { data: [], error: null },
      planning_entries: { data: [], error: null }, // neither recipe ever planned
      cooking_events: { data: [], error: null },
      selection_rounds: { data: [], error: null },
    });

    const snapshots = await buildCandidateSnapshots(supabase, ['r1', 'r2'], 'round-current');
    const thisWeek = await fetchThisWeekTagsAndCategoryKeys(supabase, []);

    const ranked = scoreCandidates({
      roundId: 'round-current',
      now: '2026-08-25T00:00:00Z',
      targetCount: 4,
      candidates: snapshots,
      thisWeekTags: thisWeek.tags,
      thisWeekCategoryKeys: thisWeek.categoryKeys,
    });

    expect(ranked).toHaveLength(2);
    // The placeholder this replaces was score: 0, reason_codes: [] for
    // every candidate — a never-planned recipe with no other candidates
    // sharing its tags must score well above that placeholder and carry
    // the never_planned reason code.
    for (const candidate of ranked) {
      expect(candidate.score).toBeGreaterThan(0);
      expect(candidate.reasonCodes).toContain('never_planned');
    }
  });
});

describe('select-candidates Edge Function wiring (source check)', () => {
  // index.ts calls Deno.serve(...) at module scope and is excluded from
  // this project's tsc (tsconfig.json) — it can't be imported under
  // Jest/Node the way this module can, and the architecture doc
  // (docs/proposals/smart-meal-selection-architecture.md §5's Testing
  // Strategy) documents that gap as accepted: only the pure scoring
  // module is meant to be Jest-testable, the orchestration is verified
  // by deployment + a live call instead. This is a narrow, low-cost
  // regression guard for the one fact worth pinning anyway: which
  // strategy version a round gets written with.
  it('sets candidate_strategy_version to heuristic-v1, not the old filter-only placeholder', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../supabase/functions/select-candidates/index.ts'),
      'utf8',
    );
    expect(source).toMatch(/STRATEGY_VERSION\s*=\s*'heuristic-v1'/);
    expect(source).not.toContain('filter-only-v1');
  });
});
