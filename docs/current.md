# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

**Keep this file short.** If you find yourself recording *what a PR did*, that belongs in the phase history file, not here. This file grew to ~2,200 words during milestone 4 and had to be extracted back out — the cost wasn't the length, it was that every merge then needed an edit here, which stranded on branches and eventually contradicted itself.

## Active work item

`docs/roadmap.md`'s **milestone 4, Smart Meal Selection ("Help Me Choose")** — sequenced ahead of Friends & Family Preview.

The full solo flow is merged and deployed: deck → shortlist → review → apply, plus "Select more". Staging is current with `main`. **`FLAGS.smartMealSelection` is on for everyone as of 2026-08-28** — the flag is kept, not deleted, as the rollback lever through the preview. Beta scope is settled: **solo-only, group is post-beta**, which is what the flip had been waiting on.

Build history, review findings, and walkthrough notes: [`docs/history/phase-18-smart-meal-selection.md`](history/phase-18-smart-meal-selection.md).

## Blocked / open follow-ups

**Weekly-plan locking — fixed 2026-08-27 ([PR #113](https://github.com/kraigstrong/Keepsake/pull/113)); one verification gap left open.** `confirm_weekly_plan` and `remove_planning_entry` now take the plan row lock before their first read, matching the three siblings that have since Phase 12. Nothing here is still to be *built*.

What remains is evidence, not code, and it should not be quietly upgraded later: **the concurrency behaviour itself is not empirically verified.** pgTAP runs a file in one transaction and cannot express a two-session race, and three local reproduction attempts were inconclusive rather than negative — the naive "does it block?" test proves nothing, because the old `confirm_weekly_plan` blocks too, just late, at its final `update`, after counting from a stale snapshot. Verified instead: the lock is present, behaviour is otherwise unchanged (46 existing tests plus four new structural guards that fail if a redefinition drops a lock). This joins Reliability's existing "verify true two-connection concurrency" item rather than closing it.

**Stale parsed ingredient text — resolved 2026-08-28, backfilled.** Found by Codex on [PR #112](https://github.com/kraigstrong/Keepsake/pull/112): `parseQuantity` runs only at write time and its output is persisted, so a parser fix reached new saves and imports only. Decision was *backfill*, chosen over reparse-on-read and over accepting it. `scripts/backfill-parsed-ingredients.ts` re-parses `line_text` with the real parser rather than re-implementing it as a SQL regex.

Applied to staging 2026-08-28: 193 rows scanned, 7 corrected — one sticks case, one `oz.` trailing-period case (#83), five dual-unit parentheticals (#89). No quantity or unit changed on any row; only `ingredient_text`. Re-run reports zero.

Two things learned that outlive this fix. `service_role` has **no SELECT or UPDATE** on `recipe_ingredients` (migrations grant SELECT to `authenticated` and withhold writes), so admin tooling needs a direct `postgres` connection, not PostgREST. And a child-table-only write is **invisible to already-synced devices** — `fetchChangedRecipes` pages on `recipes.updated_at` (ADR-0013), so the backfill also has to stamp the parent recipe, exactly as `confirm_weekly_plan` does for `planned_count`. That was missed on the first pass and corrected the same day (Codex, [PR #118](https://github.com/kraigstrong/Keepsake/pull/118)).

**Open, found while backfilling: `cup(s)` is unhandled.** `1 cup(s) (2 sticks) butter` doubles to `2 cups (s) (2 sticks) butter` — the stray `(s)` also blocks the parenthetical strip, so both defects show at once. Same beta-gating class as the bug just fixed. The corpus cannot catch this: `parseQuantity.realWorld.test.ts` is `toMatchSnapshot()`, so it records wrong output as expected — which is why it missed this, the `oz.` period, and the dual-unit cases alike. Planned fix: consume an optional `(s)` in `matchUnit` next to the existing trailing-period handling, then a debris heuristic (leading `(`, `.`, `,`, `/` in `ingredientText` is essentially never legitimate) run over real data rather than more curated lines.

Journey 3 (shared household, two-actor walkthrough) still needs a live developer session.

## Next action

**All three Friends & Family Preview gates are now closed or waiting only on credentials** (2026-08-28):

1. `"1 cup (2 sticks)"` scaling — **closed.** Parser fixed ([#112](https://github.com/kraigstrong/Keepsake/pull/112)), stored data backfilled on staging (see Blocked above).
2. Weekly-plan locking — **closed** ([#113](https://github.com/kraigstrong/Keepsake/pull/113)), with the concurrency evidence gap recorded rather than pretended away.
3. Telemetry — instrumentation done ([#115](https://github.com/kraigstrong/Keepsake/pull/115), [#116](https://github.com/kraigstrong/Keepsake/pull/116)); **waiting on a PostHog project key and a Sentry DSN**, expected 2026-08-28. Nothing can be verified end to end until those exist, since `trackEvent` is a no-op without a key.

**Blocking, added 2026-08-28: "Help me choose" overlaps the add FAB on an empty week.** The overlap [#107](https://github.com/kraigstrong/Keepsake/pull/107) fixed for populated plans is still there in the empty state — which is the first screen a new user sees. Diagnosed and placement decided; see `docs/roadmap.md`'s milestone 5 entry rather than re-deriving it.

**The long pole is now the real EAS/Xcode build**, and it is underweighted as a plain backlog item: you cannot put this on anyone else's phone without one, it has Apple-side lead times nobody here controls, and no CI job has ever built this app — so the first real build is also where you find out what is broken about building it.

Two smaller things worth doing before invites: **Journey 3** (shared-household two-actor walkthrough, still never done — friends and family are exactly the people who will share a household), and the **repository-history secret scan** from milestone 3, which is cheap now and awkward to discover late.

Walkthrough #3 (2026-08-27) went well and its one finding — the deck's stale-image flash — is fixed and merged ([#110](https://github.com/kraigstrong/Keepsake/pull/110), [#111](https://github.com/kraigstrong/Keepsake/pull/111)); see the phase-18 history, which is worth reading for how the first two attempts were aimed at the wrong layer. Terminal states were judged fine as they are, with a look-and-feel pass logged to milestone 4's backlog instead.

Still unanswered from that walkthrough, needing a device session rather than a decision:

- **Refill deck quality** — the one thing no test can answer. Appended candidates are scored against a pool excluding everything already in the deck, so on a small library the second batch is by definition what scored worst first time. Whether that reads as "more good options" or "the dregs" needs eyes on real cards.
- Then reassess the group flow, and **settle whether the beta ships solo-only** (`docs/roadmap.md`'s open question) — a developer decision that shapes how much of milestone 4 remains.

Known and deferred, don't re-report: a lost response on "Select more" can append a second batch (no duplicates, just a longer deck) — logged in `docs/roadmap.md`'s Not-yet-triaged.

**Working method worth keeping:** delegate a slice with the ADR as spec and *named required mutations*, then review the real diff and re-run the mutations independently. Four times on milestone 4 a guard was correct while no test pinned it — see the phase-18 history for the cases. A green suite is not evidence of coverage.

Also queued, unrelated: five untriaged backlog entries.
