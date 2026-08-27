# Phase 18 — Smart Meal Selection ("Help Me Choose")

Milestone 4 in [`docs/roadmap.md`](../roadmap.md), placed 2026-08-20 and sequenced ahead of Friends & Family Preview. Architecture: [`ADR-0027`](../adr/0027-smart-meal-selection-round-model.md), with [`docs/proposals/smart-meal-selection-architecture.md`](../proposals/smart-meal-selection-architecture.md) as the pre-work design pass (partly superseded — see its own banner). Design handoff: [`docs/design/help-me-choose-handoff/`](../design/help-me-choose-handoff/).

Two build-order decisions shaped everything below, both departing from the proposal's own M1–M8 sequence: **solo flow first**, and **walkable skeleton before smart ranking**. The roadmap entry records why.

## What shipped

| PR | |
|---|---|
| [#92](https://github.com/kraigstrong/Keepsake/pull/92) | Milestone placement + ADR-0027 |
| [#93](https://github.com/kraigstrong/Keepsake/pull/93) | `ServingsConfirmationStep` extracted from `AddToThisWeekScreen` — the proposal assumed this component existed; it didn't |
| [#94](https://github.com/kraigstrong/Keepsake/pull/94) | `server/selection/scoreCandidates.ts`, the deterministic ranking module |
| [#95](https://github.com/kraigstrong/Keepsake/pull/95) | Four-table schema, RLS policies, select-only grants, pgTAP |
| [#96](https://github.com/kraigstrong/Keepsake/pull/96) | Lifecycle RPCs + the centralized auto-close helper |
| [#97](https://github.com/kraigstrong/Keepsake/pull/97) | Revoked `EXECUTE` on the internal helper from `anon`/`authenticated` |
| [#98](https://github.com/kraigstrong/Keepsake/pull/98) | `select-candidates` Edge Function + client API |
| [#100](https://github.com/kraigstrong/Keepsake/pull/100) | Decision, close, and results RPCs |
| [#101](https://github.com/kraigstrong/Keepsake/pull/101) | `apply_selection_round` (2026-08-25) |
| [#102](https://github.com/kraigstrong/Keepsake/pull/102) | Heuristic wired into `select-candidates`; staging redeployed v1 filter-only → v2 heuristic-v1 |
| [#103](https://github.com/kraigstrong/Keepsake/pull/103) | [`docs/deploying-edge-functions.md`](../deploying-edge-functions.md) deploy runbook |
| [#104](https://github.com/kraigstrong/Keepsake/pull/104) | Client swipe deck — entry point 1a, start sheet 1b, deck 1d/1e |
| [#106](https://github.com/kraigstrong/Keepsake/pull/106) | Shortlist 1i + review 1k — completes the solo flow |
| [#107](https://github.com/kraigstrong/Keepsake/pull/107) | FAB overlap + deck-to-picks handoff |
| [#108](https://github.com/kraigstrong/Keepsake/pull/108) | "Select more" — `append_selection_round_candidates` + append mode |

## Review findings worth remembering

Codex review found real defects on nearly every slice. The ones with transferable lessons:

- **Ballot privacy was a denylist.** The reveal predicate read `status != 'active'`, and `'cancelled'` satisfies it — while cancelling is open to any member and closing is creator-only. Any participant could cancel mid-round and read everyone's blind ballots. Fixed as an allowlist (`ready_for_review`, `applied`) so a future status defaults to private rather than exposed.
- **Round creation wasn't recoverable.** It spans two commits around out-of-Postgres scoring, so a dead Edge Function left an `active` round with an empty deck that the one-active-round index then blocked every retry against. Rounds are now born `pending_candidates`, fenced with a `claim_token` like `finalize_import_job`.
- **The lazy-close check was an enumerated list**, leaving `clear_selection_decision` and `finish_selection_participation` able to mutate a round that should already have closed. Centralized into one helper every round-scoped RPC calls.
- **Ranking was two defects deep.** It diversified on `categories.group_name`, which holds only three values — so a beef dish and a fish dish read as identical. And deck overlap used set *membership*, so the second Beef cost what the eighth did; a balanced 10/10 pool produced a **2/10 deck**.
- **Ballot writes raced a concurrent close.** Status was read unlocked and written after, so a vote could land after `revealed_at` was set, and a completion could land after close — shifting `completed_participant_count`, the denominator of results someone may already have read. Fixed with `FOR UPDATE` on the round row.
- **`revoke ... from public` is not enough on a real Supabase project.** Default privileges grant `EXECUTE` to `anon`/`authenticated` explicitly, so a `PUBLIC` revoke leaves them. Caught only by calling staging: the helper returned **HTTP 204** for an anonymous caller while its *local* ACL looked correct.
- **The client swipe deck (#104)** drew 3 P1s + 4 P2s — pending-round misrouting to an unrecoverable empty deck, missing rollback on decision writes, undo unreachable in the terminal state and after resume, two copy overclaims.
- **Review's close-then-apply (#106)** had no recovery path if apply failed after close succeeded — deterministic once the weekly plan is confirmed mid-round — and the review route trusted an unvalidated `recipeIds` param instead of re-deriving from the caller's own yes decisions.

## The lesson that generalises

**Four times, a guard was correct while no test pinned it.** The starkest: admitting `'active'` to the results allowlist left **all 431 tests passing** while `get_selection_round_results` returned live ballot aggregates mid-round. Others: a deck-ordering test that passed with every `position` zeroed, `passed_by` missing entirely so an explicit "no" and a never-seen card were indistinguishable, and an intra-call duplicate that inserted the same recipe into This Week twice with all 452 tests green.

A green suite is not evidence of coverage. The working method that caught these: delegate a slice with the ADR as spec and *named required mutations*, then review the real diff and **re-run the mutations independently** rather than trusting the test list.

Two things pgTAP structurally cannot cover, stated rather than faked: lock ordering and any two-session race. Both were verified with real psql sessions instead — the same acknowledged gap ADR-0020 records for import fencing.

## Live walkthroughs

**#1, 2026-08-26** — "looks really great." One finding, logged not fixed: the deck's hero image lags a beat behind the card title. Diagnosed at the time as cold image bytes, with a scoped fix — extend `src/thisWeek/prefetch.ts`'s `Image.prefetch()` technique to the deck. **That diagnosis was wrong**; see #3.

**#2, 2026-08-27** — full flow. Three pieces of feedback, all addressed rather than logged: "Help me choose" overlapped the global add FAB; the "That's the deck" terminal read as unfinished placeholder copy with an unclear Continue-vs-Done choice; and reaching the end short of target offered only "done". Shipped as #107 and #108.

**#3, 2026-08-27** — picked up #1's stale-image flash. Took four attempts, and the first three were aimed at the wrong layer ([PR #110](https://github.com/kraigstrong/Keepsake/pull/110)):

1. **Prefetch the deck's hero images.** Made it faster. Flash remained.
2. **Key the `<Image>` by recipe** — one unkeyed `<Image>` meant React reused a single native view, and RN's `<Image>` holds its old bitmap until a new source loads. Real bug, real fix, flash still remained.
3. **The actual cause:** `finishAnimatedCommit` set `translateX = 0` on the UI thread and *then* called `runOnJS(decide)`. The card snapped back to centre still holding the outgoing recipe, because the re-render that swaps in the new one lands a frame or more later. Both earlier fixes operated inside that later render — which is exactly why they changed the flash's duration and shape without removing it. The fly-out now leaves the card off-screen and a layout effect recentres it once the incoming card has committed.
4. Plus rendering the next candidate beneath the top card (shared `CardFace`) so the reveal shows real content — and, on the second pass, at the top card's *exact* geometry, since hosting it in the 7px-inset `cardBehindOne` made the handoff visibly jump.

**Decision, 2026-08-27 (developer):** the flush handoff is the final behaviour. Restoring the stack-depth cue during a swipe — rendering the next card scaled down and animating it to full size — was offered and declined: the inset card "snapping around" was the jarring part, and a motionless, geometrically identical handoff reads better. The two inset placeholders stay as decoration for the last card in a deck. Don't reintroduce the depth animation without new feedback asking for it.

**The lesson, and it is the same one as the section above:** a confident, plausible, well-written diagnosis is not evidence. #1's roadmap entry named a mechanism, a precedent, and a specific fix, and it was acted on twice before anyone read the render path or the commit worklet. What finally settled it was reading `finishAnimatedCommit` and noticing a UI-thread write ordered before a JS-thread hop. Symptom-shaped fixes that "help a bit" are a signal the mechanism is still unidentified, not that the fix needs another increment.

One suppression to be aware of: writing a shared value from a layout effect makes the React compiler treat `translateX` as React-owned, so `react-hooks/immutability` is disabled alongside the pre-existing `react-hooks/refs` block covering the gesture handlers.

## Staging

Fully current with `main` as of 2026-08-27. Migrations through `append_selection_round_candidates`; Edge Functions `import-recipe` v14 and `select-candidates` **v3** (append mode, heuristic-v1).

Two operational notes worth carrying forward: **deploying a function is a separate step from pushing migrations** — `select-candidates` sat in the repo undeployed for a while before anyone noticed — and **deploy order is DB first, then function**, since the append branch calls the new RPC and the reverse leaves a window where "Select more" 502s. On the last push, `supabase db push` timed out on teardown *after* the work had committed, so the migration was verified directly (`prosecdef = true`, `authenticated` EXECUTE granted) rather than from the ledger.
