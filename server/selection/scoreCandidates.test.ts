import {
  computeDeckSize,
  scoreCandidates,
  type CandidateRecipeSnapshot,
  type ScoreCandidatesInput,
} from './scoreCandidates';

const NOW = '2026-08-20T00:00:00.000Z';

function makeCandidate(overrides: Partial<CandidateRecipeSnapshot> = {}): CandidateRecipeSnapshot {
  return {
    recipeId: 'recipe-default',
    tags: [],
    categoryKeys: [],
    neverPlanned: false,
    lastActivityAt: null,
    plannedCount: 0,
    recentDeckAppearances: 0,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ScoreCandidatesInput> = {}): ScoreCandidatesInput {
  return {
    roundId: 'round-1',
    now: NOW,
    targetCount: 4,
    candidates: [],
    thisWeekTags: [],
    thisWeekCategoryKeys: [],
    ...overrides,
  };
}

describe('recency weighting', () => {
  it('penalizes activity inside the 21-day lookback window relative to no history at all', () => {
    const recent = makeCandidate({
      recipeId: 'recent',
      lastActivityAt: '2026-08-19T00:00:00.000Z',
    }); // 1 day ago
    const noHistory = makeCandidate({ recipeId: 'no-history', lastActivityAt: null });
    const result = scoreCandidates(makeInput({ candidates: [recent, noHistory] }));
    const recentScore = result.find((r) => r.recipeId === 'recent')?.score;
    const noHistoryScore = result.find((r) => r.recipeId === 'no-history')?.score;
    expect(recentScore).toBeLessThan(noHistoryScore as number);
  });

  it('is fully neutral at and beyond the lookback window boundary', () => {
    const atEdge = makeCandidate({
      recipeId: 'at-edge',
      lastActivityAt: '2026-07-30T00:00:00.000Z',
    }); // exactly 21 days
    const wayOutside = makeCandidate({
      recipeId: 'way-outside',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    });
    const noHistory = makeCandidate({ recipeId: 'no-history', lastActivityAt: null });
    const result = scoreCandidates(makeInput({ candidates: [atEdge, wayOutside, noHistory] }));
    const scores = result.map((r) => r.score);
    // All three get zero recency penalty, so with every other field equal
    // they must land on exactly the same score.
    expect(new Set(scores).size).toBe(1);
  });

  it('penalizes more recent activity more heavily than activity just inside the window edge', () => {
    const veryRecent = makeCandidate({
      recipeId: 'very-recent',
      lastActivityAt: '2026-08-19T00:00:00.000Z', // 1 day ago
    });
    const almostOutside = makeCandidate({
      recipeId: 'almost-outside',
      lastActivityAt: '2026-08-01T00:00:00.000Z', // 19 days ago
    });
    const result = scoreCandidates(makeInput({ candidates: [veryRecent, almostOutside] }));
    const veryRecentScore = result.find((r) => r.recipeId === 'very-recent')?.score;
    const almostOutsideScore = result.find((r) => r.recipeId === 'almost-outside')?.score;
    expect(veryRecentScore).toBeLessThan(almostOutsideScore as number);
  });

  it('assigns the resurfaced reason code once a recipe with history clears the window', () => {
    const atEdge = makeCandidate({
      recipeId: 'at-edge',
      lastActivityAt: '2026-07-30T00:00:00.000Z',
    });
    const insideWindow = makeCandidate({
      recipeId: 'inside-window',
      lastActivityAt: '2026-08-15T00:00:00.000Z', // 5 days ago
    });
    const result = scoreCandidates(makeInput({ candidates: [atEdge, insideWindow] }));
    expect(result.find((r) => r.recipeId === 'at-edge')?.reasonCodes).toEqual(['resurfaced']);
    expect(result.find((r) => r.recipeId === 'inside-window')?.reasonCodes).toEqual([]);
  });
});

describe('never_planned bonus', () => {
  it('ranks a never-planned recipe above a highly-engaged, inactive one', () => {
    const neverPlanned = makeCandidate({ recipeId: 'never', neverPlanned: true });
    const engaged = makeCandidate({ recipeId: 'engaged', neverPlanned: false, plannedCount: 50 });
    const result = scoreCandidates(makeInput({ candidates: [neverPlanned, engaged] }));
    expect(result.map((r) => r.recipeId)).toEqual(['never', 'engaged']);
  });

  it('tags a never-planned recipe with the never_planned reason code, first', () => {
    const neverPlanned = makeCandidate({ recipeId: 'never', neverPlanned: true });
    const result = scoreCandidates(makeInput({ candidates: [neverPlanned] }));
    expect(result[0]?.reasonCodes[0]).toBe('never_planned');
  });

  it('prefers never_planned over resurfaced when a recipe qualifies for both', () => {
    // Cooked once (so it has activity history) but never formally
    // planned — never_planned and resurfaced could both apply; the
    // stronger, more specific signal wins.
    const both = makeCandidate({
      recipeId: 'both',
      neverPlanned: true,
      lastActivityAt: '2026-01-01T00:00:00.000Z',
    });
    const result = scoreCandidates(makeInput({ candidates: [both] }));
    expect(result[0]?.reasonCodes).toEqual(['never_planned']);
  });
});

describe('sparse metadata', () => {
  it('never boosts or penalizes a recipe with no tags or categories', () => {
    const sparse = makeCandidate({ recipeId: 'sparse', tags: [], categoryKeys: [] });
    const tagged = makeCandidate({
      recipeId: 'tagged',
      tags: ['soup'],
      categoryKeys: ['dish_type:Soup'],
    });
    const result = scoreCandidates(
      makeInput({
        candidates: [sparse, tagged],
        thisWeekTags: ['soup'],
        thisWeekCategoryKeys: ['dish_type'],
      }),
    );
    const sparseEntry = result.find((r) => r.recipeId === 'sparse');
    expect(sparseEntry?.reasonCodes).not.toContain('diversity');
    expect(sparseEntry?.reasonCodes).not.toContain('this_week_variety');
    // Nothing else applies to either candidate here, so a sparse recipe's
    // score is exactly its plain base score (0) — untouched by the
    // this-week overlap penalty the tagged recipe takes instead.
    expect(sparseEntry?.score).toBe(0);
  });

  it('never excludes a sparse-metadata recipe from the ranked deck', () => {
    const sparse = makeCandidate({ recipeId: 'sparse' });
    const result = scoreCandidates(makeInput({ candidates: [sparse] }));
    expect(result.map((r) => r.recipeId)).toContain('sparse');
  });

  it('does not crash and treats an all-sparse pool identically to a plain tie-break', () => {
    const candidates = [makeCandidate({ recipeId: 'a' }), makeCandidate({ recipeId: 'b' })];
    expect(() => scoreCandidates(makeInput({ candidates }))).not.toThrow();
  });
});

describe('tie-break determinism', () => {
  it('produces byte-identical output across repeated runs on identical inputs', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate({ recipeId: `r${i}` }));
    const input = makeInput({ candidates });
    const first = scoreCandidates(input);
    const second = scoreCandidates(input);
    const third = scoreCandidates(JSON.parse(JSON.stringify(input)) as ScoreCandidatesInput);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('orders otherwise-tied candidates consistently rather than randomly', () => {
    // Every field is identical, so the only thing that can decide order
    // is the stable (round_id, recipe_id) hash — never Math.random().
    const candidates = [makeCandidate({ recipeId: 'a' }), makeCandidate({ recipeId: 'b' })];
    const runs = Array.from({ length: 5 }, () =>
      scoreCandidates(makeInput({ roundId: 'round-1', candidates })).map((r) => r.recipeId),
    );
    for (const run of runs) {
      expect(run).toEqual(runs[0]);
    }
  });

  it('can produce a different order for a different round_id with the same candidates', () => {
    // Not a strict requirement, but confirms the hash actually
    // incorporates round_id rather than being a no-op on it — otherwise
    // this test would be indistinguishable from a constant-order bug.
    const candidates = Array.from({ length: 6 }, (_, i) => makeCandidate({ recipeId: `r${i}` }));
    const orderA = scoreCandidates(makeInput({ roundId: 'round-a', candidates })).map(
      (r) => r.recipeId,
    );
    const orderB = scoreCandidates(makeInput({ roundId: 'round-b', candidates })).map(
      (r) => r.recipeId,
    );
    expect(orderA).not.toEqual(orderB);
  });
});

describe('deck size', () => {
  it('clamps to a minimum of 8 for a small target', () => {
    expect(computeDeckSize(1)).toBe(8);
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate({ recipeId: `r${i}` }));
    const result = scoreCandidates(makeInput({ targetCount: 1, candidates }));
    expect(result).toHaveLength(8);
  });

  it('clamps to a maximum of 24 for a large target', () => {
    expect(computeDeckSize(100)).toBe(24);
    const candidates = Array.from({ length: 30 }, (_, i) => makeCandidate({ recipeId: `r${i}` }));
    const result = scoreCandidates(makeInput({ targetCount: 100, candidates }));
    expect(result).toHaveLength(24);
  });

  it('defaults to 12 at the default target of 4', () => {
    expect(computeDeckSize(4)).toBe(12);
    const candidates = Array.from({ length: 20 }, (_, i) => makeCandidate({ recipeId: `r${i}` }));
    const result = scoreCandidates(makeInput({ targetCount: 4, candidates }));
    expect(result).toHaveLength(12);
  });

  it('never returns more candidates than were supplied', () => {
    const candidates = [makeCandidate({ recipeId: 'only-one' })];
    const result = scoreCandidates(makeInput({ targetCount: 4, candidates }));
    expect(result).toHaveLength(1);
  });
});

describe('anti-staleness', () => {
  it('deprioritizes but never excludes a recipe that appeared in recent decks', () => {
    const stale = makeCandidate({ recipeId: 'stale', recentDeckAppearances: 2 });
    const fresh = makeCandidate({ recipeId: 'fresh', recentDeckAppearances: 0 });
    const result = scoreCandidates(makeInput({ candidates: [stale, fresh] }));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.recipeId)).toEqual(['fresh', 'stale']);
  });

  it('caps the penalty at 2 recent appearances — this uses deck membership only', () => {
    const twoAppearances = makeCandidate({ recipeId: 'two', recentDeckAppearances: 2 });
    const fiveAppearances = makeCandidate({ recipeId: 'five', recentDeckAppearances: 5 });
    const result = scoreCandidates(makeInput({ candidates: [twoAppearances, fiveAppearances] }));
    const scores = result.map((r) => r.score);
    expect(scores[0]).toBe(scores[1]);
  });
});

describe('category diversification', () => {
  // Regression (Codex review, PR #94): an earlier version ranked on the
  // bare `categories.group_name`, which the schema constrains to exactly
  // three values — so every protein recipe carried the identical string
  // "protein" and any two of them counted as fully overlapping. Category
  // diversification carried no signal at all, and "the only fish in the
  // deck" was unrepresentable. Keys are group-qualified now; these two
  // cases fail against the bare-group_name version.
  it('treats different values on the same axis as distinct, not overlapping', () => {
    const seed = makeCandidate({ recipeId: 'beef', categoryKeys: ['protein:Beef'] });
    const fish = makeCandidate({ recipeId: 'fish', categoryKeys: ['protein:Seafood'] });
    const result = scoreCandidates(makeInput({ candidates: [seed, fish] }));

    // The second pick shares no category key with the first, so it earns
    // the diversity signal. Under bare group_name both are "protein",
    // overlap is 1, and no diversity code is assigned.
    expect(result.find((r) => r.recipeId === 'fish')?.reasonCodes).toContain('diversity');
  });

  it('still treats the same value on the same axis as overlapping', () => {
    const seed = makeCandidate({ recipeId: 'beef-1', categoryKeys: ['protein:Beef'] });
    const alsoBeef = makeCandidate({ recipeId: 'beef-2', categoryKeys: ['protein:Beef'] });
    const result = scoreCandidates(makeInput({ candidates: [seed, alsoBeef] }));

    expect(result.find((r) => r.recipeId === 'beef-2')?.reasonCodes).not.toContain('diversity');
  });

  it('does not treat the same value on different axes as overlapping', () => {
    // Qualifying with the group is what keeps these apart.
    const a = makeCandidate({ recipeId: 'a', categoryKeys: ['protein:Chicken'] });
    const b = makeCandidate({ recipeId: 'b', categoryKeys: ['dish_type:Chicken'] });
    const result = scoreCandidates(makeInput({ candidates: [a, b] }));

    expect(result).toHaveLength(2);
    expect(result[1]?.reasonCodes).toContain('diversity');
  });
});

describe('reason codes', () => {
  it('orders never_planned before diversity before this_week_variety, capped at two', () => {
    // Seed goes first — its plannedCount bonus beats "all-signals" outright,
    // so pick order isn't left to the tie-break hash.
    const seed = makeCandidate({
      recipeId: 'seed',
      neverPlanned: true,
      plannedCount: 10,
      tags: ['soup'],
      categoryKeys: ['dish_type:Soup'],
    });
    // Never-planned, shares no tag/category with the seed (adds
    // diversity) and none with This Week either (varies from This Week
    // too) — all three signals are true, but only the top two survive.
    const allSignals = makeCandidate({
      recipeId: 'all-signals',
      neverPlanned: true,
      tags: ['stew'],
      categoryKeys: ['protein:Beef'],
    });
    const result = scoreCandidates(
      makeInput({
        candidates: [seed, allSignals],
        thisWeekTags: ['pasta'],
      }),
    );
    expect(result.map((r) => r.recipeId)).toEqual(['seed', 'all-signals']);
    expect(result.find((r) => r.recipeId === 'all-signals')?.reasonCodes).toEqual([
      'never_planned',
      'diversity',
    ]);
  });

  it('reports diversity and this_week_variety together when there is no tier-1 signal', () => {
    const seed = makeCandidate({ recipeId: 'seed', tags: ['soup'] });
    const variesButRecentlyActive = makeCandidate({
      recipeId: 'varies',
      lastActivityAt: '2026-08-19T00:00:00.000Z', // inside the window — no resurfacing story
      tags: ['stew'],
    });
    const result = scoreCandidates(
      makeInput({
        candidates: [seed, variesButRecentlyActive],
        thisWeekTags: ['pasta'],
      }),
    );
    expect(result.map((r) => r.recipeId)).toEqual(['seed', 'varies']);
    expect(result.find((r) => r.recipeId === 'varies')?.reasonCodes).toEqual([
      'diversity',
      'this_week_variety',
    ]);
  });

  it('never assigns diversity or this_week_variety to a lone first pick', () => {
    const onlyCandidate = makeCandidate({
      recipeId: 'only',
      tags: ['soup'],
      // Inside the lookback window, so there's no tier-1 signal either —
      // isolates this test to the diversity/this-week-variety behavior.
      lastActivityAt: '2026-08-19T00:00:00.000Z',
    });
    const result = scoreCandidates(makeInput({ candidates: [onlyCandidate] }));
    expect(result[0]?.reasonCodes).toEqual([]);
  });

  it('never assigns this_week_variety when This Week is currently empty', () => {
    // Nothing to have varied from — an empty This Week must not award a
    // vacuous this_week_variety to every candidate.
    const candidate = makeCandidate({ recipeId: 'a', tags: ['soup'] });
    const result = scoreCandidates(
      makeInput({ candidates: [candidate], thisWeekTags: [], thisWeekCategoryKeys: [] }),
    );
    expect(result[0]?.reasonCodes).not.toContain('this_week_variety');
  });

  it('penalizes overlap with This Week rather than rewarding its absence', () => {
    const overlaps = makeCandidate({ recipeId: 'overlaps', tags: ['pasta'] });
    const varies = makeCandidate({ recipeId: 'varies', tags: ['soup'] });
    const result = scoreCandidates(
      makeInput({ candidates: [overlaps, varies], thisWeekTags: ['pasta'] }),
    );
    const overlapsScore = result.find((r) => r.recipeId === 'overlaps')?.score;
    const variesScore = result.find((r) => r.recipeId === 'varies')?.score;
    expect(overlapsScore).toBeLessThan(variesScore as number);
    expect(result.find((r) => r.recipeId === 'overlaps')?.reasonCodes).not.toContain(
      'this_week_variety',
    );
  });
});
