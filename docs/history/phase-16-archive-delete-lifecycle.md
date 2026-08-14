# Phase 16 — Archive, Recently Deleted, and Destructive Lifecycle

**Result:** Pass | **Date:** 2026-08-12 (build) / 2026-08-13 (exit review) | **PRs:** [#49](https://github.com/kraigstrong/Keepsake/pull/49), [#50](https://github.com/kraigstrong/Keepsake/pull/50)

## Product increment

A recipe's lifecycle is now complete: Archive/Unarchive from Recipe Detail, soft Delete (confirmed) to Recently Deleted, Restore, and Permanent Delete (also confirmed) with best-effort client-side Storage cleanup. Two new screens — Archived Recipes and Recently Deleted, both reached from Settings. Archived and deleted recipes are excluded from Library, Search, Frequently Selected/Recently Added, and This Week planning — the last of those server-enforced on the planning RPCs themselves, not just the add-recipe picker.

## PRD requirements covered

LIFE-01 through LIFE-07, FREQ-02 — all `Done (tested)` in `docs/prd-traceability.md`. LIFE-02 carries a documented deviation: this app has never built an overflow menu, so Archived Recipes is reached from Settings and Archive/Unarchive live as plain Recipe Detail action-row buttons instead (ADR-0025 decision 7).

## Automated evidence

20 commits across two PRs. Three forward-only migrations (`recipes.archived_at`/`deleted_at` + indexes, five lifecycle RPCs, a security-fix migration for two Codex-found gaps). pgTAP (`recipe_lifecycle_rpcs.test.sql`, 25 assertions covering all 5 RPCs, idempotency, cross-household rejection, source_url collision/re-import races) is CI-only, consistent with every phase since Docker became unavailable locally. Both PRs' merge commits passed all four required CI checks (typecheck/lint/format/tests, migration apply + RLS tests, gitleaks, npm audit). Re-verified against current `main` as part of this exit review: `tsc --noEmit` clean, `eslint .` clean, full suite 109 suites / 968 passed / 1 skipped (live-Anthropic-API test, gated per project convention). Both migrations confirmed pushed to staging (`supabase migration list`, local/remote match).

## Human evidence

A physical-device walkthrough was performed (PR #50) — found and fixed 5 real bugs, though most were cross-cutting (Cooking Mode/This Week scaling), not Phase 16 itself. Phase 16 is not on ADR-0003's required-physical-device list; this exceeds what the gate requires.

## Security review

- **New data:** `recipes.archived_at`/`deleted_at` (nullable timestamptz). No new RLS policy needed — existing `is_household_member` policies already cover the columns on the same table.
- **Authorization:** all five RPCs (`archive_recipe`, `unarchive_recipe`, `delete_recipe`, `restore_recipe`, `permanently_delete_recipe`) are `SECURITY DEFINER`, re-derive `household_id` from `auth.uid()`, `revoke all ... / grant execute ... to authenticated` — same shape every mutating RPC has used since Phase 12.
- **Idempotency (SEC-07):** `coalesce()` on archive/unarchive/delete preserves the true first-action timestamp across a retry. `permanently_delete_recipe` distinguishes "not deleted" (raises) from "already permanently deleted" (tombstone check against `deleted_recipes`, quiet success) rather than collapsing every 0-row outcome — deliberate, per ADR-0025's decision-2 amendment.
- **Two real gaps found and fixed before merge (Codex review, PR #49):** a TOCTOU race in `permanently_delete_recipe` (deleted-state check moved into the `DELETE`'s own `WHERE` clause so check-and-delete are one atomic statement) and in `restore_recipe`; and a server-side authorization gap where `add_to_weekly_plan`/`add_recipes_to_weekly_plan` validated household ownership but not `archived_at`/`deleted_at` — a client bypassing the This-Week picker could otherwise still plan an archived/deleted recipe. A third race (restore-vs-concurrent-import URL collision) was found and fixed in a follow-up review round.
- **Asset cleanup:** best-effort from the client (`permanently_delete_recipe` returns the doomed row's Storage paths, client calls `storage.remove()` after) — accepted residual risk, same class as ADR-0017/T15, not new.
- **`SEC-07` in `docs/prd-traceability.md` was stale (`Not Started`) despite this phase being its owning phase and satisfying it** — corrected to `Done (tested)` as part of this exit review, evidenced by the idempotency/authorization points above.
- No new credentials. No recipe content in logs; actor identity is implicit via `auth.uid()` in every RPC call, same pattern as every other phase — no bespoke audit-log table, consistent with this project's existing posture.

## Commit history

**PR #49** (13 commits): ADR → schema → RPCs → local schema/sync plumbing → exclusion filters across Library/Search/This-Week/import-duplicate-detection → client data layer → Recipe Detail actions → Archived Recipes screen → Recently Deleted screen → traceability → Codex-review fixes (import_jobs FK, TOCTOU, planning enforcement) → a second Codex-review fix (restore/re-import URL race). **PR #50** (7 commits): developer walkthrough fixes, mostly cross-cutting to Phase 12/15 — the one Phase-16-specific item is disclosing (not fixing) the Archive/Delete button-placement UX complaint. Secret scan clean on every commit.

## Pull requests

[#49](https://github.com/kraigstrong/Keepsake/pull/49) — full build scope, LIFE-01..07/FREQ-02, three migrations. Reviewed by Codex (three findings, all fixed and replied to inline before merge, plus one more in a re-review round). [#50](https://github.com/kraigstrong/Keepsake/pull/50) — first physical-device walkthrough's fixes; scoped mostly outside Phase 16 (see `docs/history/cross-cutting-adr-0026-multiplier.md` for the ADR-0026 work it spawned).

## Credential review

No new credentials introduced this phase.

## Known limitations

- **Storage cleanup is client-side best-effort** — a network drop between RPC success and the client's cleanup call leaves an orphaned Storage object. Accepted, same class as ADR-0017/T15.
- **No offline mirror for Archived Recipes/Recently Deleted** — deliberate (ADR-0025 decision 6), matching ADR-0021/ADR-0024's precedent for This Week and cooking history.
- **A permanently-deleted recipe can leave a zombie cooking-event outbox item** on another device that had an unsynced completion for it — narrow window (needs an unsynced offline event *and* a concurrent permanent delete before sync), bounded to log noise/wasted retries. Real fix needs a terminal/no-op outcome added to the outbox's retry classification (an ADR-0024 design change), tracked as a carried-forward item in `docs/current.md`, not fixed here.
- **Archive/Delete button placement in Recipe Detail's action row "didn't feel right"** per the developer's own walkthrough — functionally correct, UX polish explicitly deferred, not scoped yet. Tracked in `docs/current.md`.

## Exit decision

**Pass** (developer decision, 2026-08-13). Build scope complete, all owned PRD requirement IDs `Done (tested)`, all four required CI checks passed on both merge commits, both migrations confirmed on staging, full suite re-verified clean against current `main`. No Critical or High release-blocking defect remains open — every gap found during review (RLS/TOCTOU/authorization races) was fixed before merge with regression coverage, not deferred. The physical-device walkthrough exceeded what ADR-0003 requires for this phase. Remaining known limitations above are accepted/deliberate or narrow-and-disclosed, not conditions of this Pass.
