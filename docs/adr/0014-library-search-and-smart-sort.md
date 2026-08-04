# ADR-0014: Library search, filters, and Smart sort design

- **Status:** Accepted
- **Date:** 2026-08-03
- **Phase:** 7

## Context

Phase 7's build scope (execution-plan.md) is Library, Smart sort, search, and filters. Three things need deciding before writing schema or client code, none of which the PRD, execution-plan.md, or an existing ADR resolves:

1. **FTS5 integration shape.** Phase 1's risk spike (`docs/risk-spikes/sqlite-fts.md`) proved the FTS5 pattern works against a standalone spike schema (`src/search/schema.ts`) with an `integer primary key` `recipe` content table and insert-only triggers. The real local `recipes` table (Phase 6, `src/db/schema.ts`) has a `text primary key` (the server's UUID) and is maintained by `src/sync/local.ts`, not SQL triggers. FTS5's `content=`/`content_rowid=` external-content linking expects an integer rowid; while SQLite gives every ordinary table an implicit rowid even when the declared primary key is `text`, that implicit rowid is not guaranteed stable across a `VACUUM` unless it's declared as an `integer primary key` alias — a real, non-obvious footgun for a table already keyed by a stable UUID.
2. **bm25 title-priority tiebreak.** The risk spike found that weighting bm25 columns (`bm25(recipe_fts, 10.0, 5.0, 1.0, ...)`) does not reliably rank title matches above ingredient matches — IDF dominates the weight multiplier for common query terms, confirmed with a controlled pair scoring nearly tied. Flagged explicitly as unsolved, for Phase 7 to resolve.
3. **Smart sort's "Frequently Selected" tier.** prd.md §14/§16: default sort is Recently Added (<2wk) → Frequently Selected (by planned count) → remaining; "Archived recipes disappear." Neither planned count (This Week planning, Phase 12) nor archive (Phase 16) exist yet — there is no data source for this tier or that exclusion in this phase.

## Decision

**1. FTS5 tables are standalone, not external-content, keyed by the real UUID as an `unindexed` column.** `recipe_fts`/`recipe_trigram` store their own copy of the indexed text (title, ingredients-as-flattened-text, notes, source attribution, source URL, categories, tags) plus an `unindexed` `recipe_id` text column — no `content=`/`content_rowid=` link to `recipes`, no dependency on implicit rowid stability. Maintained explicitly from `src/sync/local.ts` wherever a recipe is upserted or deleted locally (the sync engine already touches every changed id — this reuses that boundary rather than adding SQL triggers on a table Phase 6 already owns). A local recipe update is a delete-by-`recipe_id`-then-reinsert into the FTS tables, not an UPDATE (FTS5's own recommended pattern for content changes).

**2. Title priority is a strict tier, not a blended weight.** Query `recipe_fts` for title-column and full-table matches separately; rank all title-column matches (any bm25 score) above all non-title matches, and use `bm25(...)` only to order within each tier. This satisfies SRCH-02's literal "title, then ingredients, then everything else" ordering by construction, rather than relying on weight tuning the risk spike already showed is unreliable. Ingredients vs. "everything else" gets the same tiering treatment as the second/third tier.

**3. Smart sort ships two of its three tiers this phase; the third is a tracked, explicit gap, not a guess.** Recently Added (<2wk) and an alphabetical "remaining" tier (PRD doesn't specify remaining's order; alphabetical is already one of the offered "Additional sorts," so it's a principled choice rather than an arbitrary one) are real. Frequently Selected is skipped entirely rather than stubbed with a fabricated always-zero column — Phase 12 hasn't decided whether planned count is a denormalized counter, a derived join, or something else, and guessing that shape now risks a migration Phase 12 has to undo. LIB-01 stays `In Progress` in prd-traceability.md, not `Done (tested)`, until Phase 12 completes it. "Archived recipes disappear" is vacuously true until Phase 16 adds an archived state — no filtering code needed yet, nothing to hide.

## Alternatives considered

- **External-content FTS5 keyed by `recipes`' implicit rowid** — rejected for the VACUUM-stability footgun above; saves a small amount of duplicated storage at the cost of a subtle, hard-to-test correctness risk.
- **Blended bm25 column weights** — rejected; the risk spike already falsified this as unreliable at realistic scale.
- **Stub `planned_count` column defaulting to 0** — rejected; unlike Phase 6's tombstone table (whose shape was obvious in advance — one row per deleted id), Phase 12 hasn't decided planned count's storage shape, so pre-committing to a column now is a guess, not forward-compatible plumbing.

## Consequences

FTS index maintenance becomes the sync engine's responsibility (`src/sync/local.ts`), not a schema-level trigger — easier to unit test (already-mocked `MigratableDatabase`-style seam), harder to accidentally forget when adding a new local write path outside the sync engine (there currently is none; editing still requires connectivity per OFF-04). Search and Library both read from the real `recipes` mirror's actual data, so results are consistent with what Library shows — no second source of truth to drift. Smart sort's incompleteness is visible in `docs/prd-traceability.md` and `docs/phase-status.md`, not hidden — Phase 12 has a concrete, named follow-up rather than inheriting silently-wrong behavior.
