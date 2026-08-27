# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

**Keep this file short.** If you find yourself recording *what a PR did*, that belongs in the phase history file, not here. This file grew to ~2,200 words during milestone 4 and had to be extracted back out — the cost wasn't the length, it was that every merge then needed an edit here, which stranded on branches and eventually contradicted itself.

## Active work item

`docs/roadmap.md`'s **milestone 4, Smart Meal Selection ("Help Me Choose")** — sequenced ahead of Friends & Family Preview.

The full solo flow is merged and deployed: deck → shortlist → review → apply, plus "Select more". Staging is current with `main`. `FLAGS.smartMealSelection` still defaults to `false`.

Build history, review findings, and walkthrough notes: [`docs/history/phase-18-smart-meal-selection.md`](history/phase-18-smart-meal-selection.md).

## Blocked / open follow-ups

**Weekly-plan locking gap — Friends & Family Preview gate, not yet scheduled.** `apply_selection_round` locks the target plan, but `confirm_weekly_plan` and `remove_planning_entry` never take that lock, so apply is serialised against the adders and not those two. Worst case is silent: a confirm interleaving with an apply leaves a confirmed plan holding `counted = false` entries whose `planned_count` was never incremented — permanent drift in a number the ranking heuristic reads, that no user would think to report. Pre-existing since Phase 12; apply is just the first caller depending on it. Decision 2026-08-25: merge #101, fix this next rather than block.

Journey 3 (shared household, two-actor walkthrough) still needs a live developer session.

## Next action

**Clearing the two Friends & Family Preview gates** (developer direction, 2026-08-27), in order:

1. ~~The `"1 cup (2 sticks)"` scaling bug.~~ **Done** — branch `units/stick-parenthetical-scaling`. Fixed by a route neither candidate in the roadmap anticipated; that entry records why the recommended one was the riskier option.
2. **The weekly-plan locking gap** — the remaining open item under Blocked below, and the next thing to pick up. A locking pass across the RPC family, not a patch to one function.

Walkthrough #3 (2026-08-27) went well and its one finding — the deck's stale-image flash — is fixed and merged ([#110](https://github.com/kraigstrong/Keepsake/pull/110), [#111](https://github.com/kraigstrong/Keepsake/pull/111)); see the phase-18 history, which is worth reading for how the first two attempts were aimed at the wrong layer. Terminal states were judged fine as they are, with a look-and-feel pass logged to milestone 4's backlog instead.

Still unanswered from that walkthrough, needing a device session rather than a decision:

- **Refill deck quality** — the one thing no test can answer. Appended candidates are scored against a pool excluding everything already in the deck, so on a small library the second batch is by definition what scored worst first time. Whether that reads as "more good options" or "the dregs" needs eyes on real cards.
- Then reassess the group flow, and **settle whether the beta ships solo-only** (`docs/roadmap.md`'s open question) — a developer decision that shapes how much of milestone 4 remains.

Known and deferred, don't re-report: a lost response on "Select more" can append a second batch (no duplicates, just a longer deck) — logged in `docs/roadmap.md`'s Not-yet-triaged.

**Working method worth keeping:** delegate a slice with the ADR as spec and *named required mutations*, then review the real diff and re-run the mutations independently. Four times on milestone 4 a guard was correct while no test pinned it — see the phase-18 history for the cases. A green suite is not evidence of coverage.

Also queued, unrelated: five untriaged backlog entries, and the `"1 cup (2 sticks)"` scaling bug (a Friends & Family Preview gate, not urgent).
