# Risk Spike: SQLite Full-Text Search

**Phase 1.** Proves the pattern SRCH-01 through SRCH-05 (Phase 7) will build on, before Phase 7 invests in the real feature.

## Question

Can `expo-sqlite`'s FTS5 support actually deliver what the PRD wants: title-priority ranking (SRCH-02), typo tolerance (SRCH-03), and singular/plural matching (SRCH-04) — at acceptable performance on a realistic library size?

## Method

Validated the SQL design against Node's built-in `node:sqlite` (SQLite 3.51.3) rather than round-tripping through a full native iOS build for every iteration — legitimate because the questions being tested (FTS5/porter/trigram/bm25 *behavior*) are core SQLite extension code, not iOS-platform-specific. Confirmed `expo-sqlite` vendors an equivalent, recent build for iOS: it bundles its own SQLite amalgamation (`node_modules/expo-sqlite/vendor/sqlite3/sqlite3.c`, version 3.50.3 — not the OS's system SQLite) and compiles with `-DSQLITE_ENABLE_FTS5=1` by default (`ios/ExpoSQLite.podspec`); the trigram tokenizer is part of the FTS5 extension itself, not a separate flag, and its source is present in the vendored amalgamation.

**Not yet done:** on-device confirmation that this behaves identically inside the actual compiled app (recommended before Phase 7 relies on it, given the two SQLite builds — Node's and expo-sqlite's — while both recent and FTS5-complete, are not byte-identical).

## Findings

### Singular/plural (SRCH-04) — works as expected

The `porter unicode61` tokenizer's stemming handles this correctly out of the box: a query for `tomato` matches documents containing `tomatoes` and vice versa, with no extra code. Cheapest win of the spike.

### Typo tolerance (SRCH-03) — does NOT work out of the box; a specific fallback pattern does

Neither tokenizer tolerates typos through a normal `MATCH` query:

- `porter unicode61`: a query is tokenized into stemmed words and ANDed — a 1-character typo produces a different word entirely, zero results.
- `trigram`: **also fails**, and this was the actual surprise — trigram tokenization applies to the *query* too, and FTS5's default `MATCH` semantics AND all of a multi-trigram query together. A single-character typo changes several of the query's trigrams, so the strict AND still fails to match even though most trigrams are shared with the intended target.

**What does work, validated:** querying the trigram index with the query's trigrams **OR'd together** instead of relying on `MATCH`'s implicit AND, then ranking candidates by trigram-overlap count. Tested against `tomatto` → `Roasted Tomato Soup` and `chiken` → `Chicken Tikka Masala`, both resolved correctly. This is `buildFuzzyMatchQuery()` in `src/search/buildSearchQuery.ts`, used only as a fallback when the exact/stemmed path (above) returns zero rows — trigram-overlap ranking is much looser than bm25 and would surface worse results first if used as the primary path.

### Title-priority ranking (SRCH-02) — real, needs more design than "just weight the column"

The naive approach — pass column weights to `bm25(recipe_fts, 10.0, 5.0, 1.0, ...)` so title counts 10x an ingredient match — does not reliably make title matches outrank ingredient matches. Root cause: BM25's IDF (inverse-document-frequency) term dominates when a query word is common across the corpus, which can outweigh the column weight multiplier, especially against many short documents. Confirmed with a controlled pair (`Roasted Tomato Soup`, matching in both title and ingredients, vs. a short auto-generated title also containing the query term) — their bm25 scores came back nearly tied (`-0.00000205` vs. `-0.00000202`), not the wide gap the 10x weight would suggest.

**Not solved by this spike** — flagging as a genuine open design question for Phase 7, not something to paper over:
- A secondary sort key (e.g., exact-phrase-in-title boost, or preferring shorter titles) on top of bm25.
- Or a custom ranking function instead of stock bm25 weights.
- Worth revisiting with a realistic recipe corpus rather than synthetic bulk data — real recipe titles/ingredient lists have different length/term-frequency distributions than the benchmark fixtures here.

### Performance — no concern at realistic scale

Benchmarked against 2,004 synthetic recipes (a deliberately generous stand-in for "a household's lifetime collection" — PRD doesn't state a target size). Every query — single-term, multi-term, at the full corpus size — completed in under 1ms. Not a bottleneck worth further attention at this phase.

## Automated evidence

`src/search/buildSearchQuery.test.ts` — 7 unit tests covering query construction, per-word FTS5-literal escaping (the untrusted-input boundary — see below), bm25 weight ordering, and the trigram-fallback guard for sub-3-character input. These test the *query-building logic*, not live SQLite behavior (see "Not yet done" above and the note in `src/search/search.ts`).

## Security note (execution-plan.md §2.6 — input validation)

Raw search input is untrusted (prd.md §30). FTS5 `MATCH` has its own query syntax (`AND`/`OR`/`NOT`, `NEAR`, `col:` filters, `-exclude`, `*prefix`) — passing a search box's raw text straight into `MATCH` turns it into a query-syntax injection point, not just a data value. `toFts5MatchLiteral()` splits on whitespace and quotes each word individually as an FTS5 string literal (doubling embedded `"`), which keeps "all these words, in any order" search semantics while guaranteeing every word is treated as literal text, never syntax — tested explicitly with input containing bare `NOT`/`OR`/`*` tokens.

## Conclusion

Chosen implementation path exists (Phase 1's exit-gate bar): FTS5 + porter stemming for exact/stemmed matching, trigram-OR fallback for typo tolerance, both confirmed available in `expo-sqlite`'s default iOS build. Title-priority ranking needs more design work than assumed — tracked as an open item for Phase 7, not a blocker for Phase 1 (a path exists — bm25 weighting plus a secondary sort key — even though the exact secondary key isn't chosen yet).
