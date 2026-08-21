# Current Status

A pointer to what's actively selected right now, not a log — update it when the active work item's state, blocker, or next action materially changes. `docs/roadmap.md` holds the milestone/backlog layer; `docs/history/phase-NN-*.md` holds phase-by-phase build history, one file per phase.

## Active work item

`docs/roadmap.md`'s **milestone 4, Smart Meal Selection ("Help Me Choose")** — placed 2026-08-20 and sequenced **ahead of Friends & Family Preview**, so the beta ships with it. Build order: **solo flow first**, and **walkable skeleton before smart ranking** (see the roadmap entry for why each departs from the proposal's own M1–M8).

Three of the milestone's PRs are done; the fourth is built but unreviewed.

- [PR #92](https://github.com/kraigstrong/Keepsake/pull/92) — milestone placement + [`ADR-0027`](adr/0027-smart-meal-selection-round-model.md). **Merged.**
- [PR #93](https://github.com/kraigstrong/Keepsake/pull/93) — `ServingsConfirmationStep` extracted out of `AddToThisWeekScreen`. **Merged.** The proposal had assumed this component already existed; it didn't.
- [PR #94](https://github.com/kraigstrong/Keepsake/pull/94) — `server/selection/scoreCandidates.ts`, the deterministic v1 ranking heuristic (24 tests, pure, DB-free).
- Branch **`feature/selection-schema`** — four-table schema, RLS policies + select-only grants, and a pgTAP suite. Three commits, **not pushed, not reviewed, no PR.** See Next action.

## Blocked

Journey 3 (shared household — a two-actor walkthrough) still needs a live developer session that neither automated tests nor pgTAP's single-transaction model can substitute for.

## Current state

- Five of six journeys (offline, lifecycle, security, credential validation, website success) are confirmed against current code/CI and, for website success, a live real-device walkthrough — see `docs/roadmap.md`'s MVP Validation status for the per-journey summary.
- Journey 1 closed 2026-08-19: real device, developer driving, agent watching Supabase Edge Function logs. URL import (real Anthropic call), grocery generation/export, and Cooking Mode (unit scaling, checklist, Done Cooking, notes) all walked live successfully. Also confirmed PR #81's structured error logging is live and deployed (`import-recipe` redeployed same session — it had been stale since Aug 15). Four non-blocking bugs found and logged in `docs/roadmap.md`'s Reliability/Not-yet-triaged backlogs, none fixed blind: a grocery-merge unit-selection bug (done, see below), a period-abbreviated-unit parsing gap (code fix ready for PR, see below), a Cooking Mode Done-Cooking double-tap (fixed and confirmed live 2026-08-20 — see `docs/roadmap.md`'s Not-yet-triaged entry for the actual root cause, which turned out not to be the `Sheet.tsx` relayout originally suspected here), and a reinforced cold-launch onboarding-flash finding (fixed and confirmed live 2026-08-20, see below).
- Cold-launch onboarding-flash fixed 2026-08-20 ([PR #87](https://github.com/kraigstrong/Keepsake/pull/87), merged) — real root cause was a `HouseholdProvider` race (see `docs/roadmap.md`'s Not-yet-triaged entry), not the originally-suspected `Sheet.tsx` relayout. Landed alongside a new `StartupScreen` cold-launch loading state, sourced from a real design handoff read directly from Claude Design this session (project "Keepsake: Three visual directions", file "Keepsake Icon System.dc.html", saved locally at `docs/design/keepsake-icon-system/`) — that same design also contains a full 22-icon UI-set replacement and app-icon colorways, scoped as a separate backlog item (`docs/roadmap.md`'s Not-yet-triaged) and deferred at the time per developer direction (2026-08-20: scope it, but only build the startup screen that session) — both have since shipped, see Recently shipped below. Iterated live with the developer past the initial fix into a genuinely instant cold-launch-to-This-Week transition: This Week's plan and hero images are now prefetched during StartupScreen (`src/thisWeek/prefetch.ts`) — plan + signed URLs batched, actual photo bytes warmed via `Image.prefetch()`, and StartupScreen now waits (boundedly, 2.5s) for that prefetch before dismissing, with `ThisWeekScreen` seeding its state directly from whatever's already resolved rather than starting blank. Final developer confirmation: "this looks perfect." Prefetch is scoped to This Week's entries only, not the full recipe library (library has no thumbnails to prefetch today).
- Grocery-merge unit-selection bug fixed 2026-08-19 ([PR #82](https://github.com/kraigstrong/Keepsake/pull/82), merged).
- Period-abbreviated-unit parsing gap: code fix + tests done 2026-08-19, shipped as [PR #83](https://github.com/kraigstrong/Keepsake/pull/83) (merged). A proactive survey of ~65 real ingredient lines from 9 live recipes (developer's request, to catch more edge cases in one pass instead of one at a time) confirmed the fix generalizes beyond the one recipe that surfaced it, and turned up two more `parseQuantity()` gaps — both now fixed (see below). Still open on the period fix itself: a one-time re-parse backfill for the one known affected recipe on staging, needs explicit developer go-ahead (staging write).
- "N and X/Y unit" mixed-number fix shipped 2026-08-20 ([PR #88](https://github.com/kraigstrong/Keepsake/pull/88), merged) — Codex review raised no issues. Verified against a fresh pull of 16 real recipes (~165 ingredient lines) rather than trusting the fix on the one known case alone (developer request); no new gaps surfaced. Also added a maintained real-world ingredient corpus + snapshot regression test (`server/units/realWorldIngredientCorpus.ts`, `parseQuantity.realWorld.test.ts`) for future `parseQuantity()` work, meant to be extended by future surveys rather than replaced.
- Compound parenthetical annotations fix shipped 2026-08-20 ([PR #89](https://github.com/kraigstrong/Keepsake/pull/89), merged) — the other `parseQuantity()` gap from the same 2026-08-19 survey: `stripParentheticalAlternateUnit()` now handles a ranged annotation ("45–75g/ml") and a dual-unit slash annotation ("113g/120ml") inside the parens, not just a single number+unit. Both real lines added to the real-world ingredient corpus. Codex review caught a real follow-up gap same day (the "/" separator didn't tolerate surrounding whitespace, e.g. "113g / 120ml") — fixed, replied inline, second Codex pass came back clean ("Didn't find any major issues"). This closes out both `parseQuantity()` gaps found in the 2026-08-19 survey.
- Parallel, code-only reliability work picked up while blocked: transport-failure retry for recipe imports shipped ([PR #77](https://github.com/kraigstrong/Keepsake/pull/77), merged) — see `docs/roadmap.md`'s Reliability milestone. Category-mapping robustness (ORG-04/AI-06) also shipped ([PR #79](https://github.com/kraigstrong/Keepsake/pull/79), merged 2026-08-19) — see `docs/history/phase-08-url-import.md`. Structured server error logging shipped next ([PR #81](https://github.com/kraigstrong/Keepsake/pull/81), merged 2026-08-20) — live-verified as part of today's Journey 1 walkthrough. Period-abbreviated-unit parsing fix shipped ([PR #83](https://github.com/kraigstrong/Keepsake/pull/83), merged) — the one-time re-parse backfill for the affected staging recipe is still open pending developer go-ahead (staging write).
- A codebase-grounded architecture proposal for "Help Me Choose" / Smart Meal Selection landed ([PR #84](https://github.com/kraigstrong/Keepsake/pull/84), merged) — [`docs/proposals/smart-meal-selection-architecture.md`](proposals/smart-meal-selection-architecture.md), reconciled against the Claude Design Studio wireframe handoff. It's a proposal only, still parked under `docs/roadmap.md`'s Unplaced section — not sequenced or started as implementation.

## Next action

**Review and land `feature/selection-schema`** (local branch, 3 commits, never pushed). This is milestone 4's security boundary and was deliberately *not* rushed at the end of the 2026-08-20 session. It needs the full treatment before it goes near a PR:

1. `npm run db:test` — the implementing agent could not run pgTAP (no container runtime existed at the time). **Colima + docker are now installed**, so `npm run db:start && npm run db:test` works locally; don't rely on CI for the first pass.
2. `.claude/skills/security-check` — this touches RLS and a household boundary, so it is triggered, not optional.
3. An independent look from an agent that didn't write it, or `/code-review`, per the lifecycle's step 6.

Four things in that branch came out of Codex's review of ADR-0027 and are the specific places to check hardest, because following the *proposal* instead of the ADR reintroduces each one:

- The `selection_decisions` SELECT policy must be the **allowlist** (`status IN ('ready_for_review','applied')`), never `!= 'active'` — the latter makes open-access `cancel_selection_round` a ballot-disclosure path around the creator-only close gate.
- The singleton unique index must span **all three** non-terminal statuses (`pending_candidates`, `active`, `ready_for_review`).
- `claim_token` and `revealed_at` columns must exist for later slices to fence on.
- No INSERT/UPDATE/DELETE grants to `authenticated` on any of the four tables.

Then the rest of milestone 4's spine, in order: lifecycle RPCs + `select-candidates` Edge Function (filter-only deck) → decision RPCs + close + results → `apply_selection_round` (highest risk) → client solo flow → **first live solo walkthrough** → wire in PR #94's heuristic → second walkthrough to judge deck quality.

Two decisions deliberately deferred, neither blocking: whether the beta ships **solo-only** or waits for the group flow (settle before the flag flip), and the staging `supabase db push` once the first migration merges (a staging write needing explicit developer go-ahead).

**Two findings recorded 2026-08-20, both open:**

- **[PR #94](https://github.com/kraigstrong/Keepsake/pull/94) is deliberately unmerged.** Codex found that `scoreCandidates.ts` diversifies on `categories.group_name`, which is constrained to just three values (`protein`/`dish_type`/`preparation`) — `value` holds the distinguishing label. So a beef dish and a fish dish read as identical, the penalty lands uniformly, and "the only fish in the deck" is unrepresentable. Category diversification carries no signal; only tags work. Fix is two parts: a group-qualified category key in the module, **and** a correction to the proposal's §5, which says "round-robining across `tags` and category `group_name` values" and is what the implementation faithfully followed. Add it to that document's supersession banner.
- **The main checkout's `node_modules` is in a bad state.** `src/thisWeek/ThisWeekScreen.test.tsx` fails there at the `react-native-gesture-handler/ReanimatedSwipeable` require, and an agent reported this as "pre-existing on `main`" — it is not. The same suite passes in a clean worktree against current `main` (1140 passed) and in CI on #93/#94. Run `npm ci` in the main checkout before trusting a local `npm test` there.

Unrelated and still open: the staging backfill for PR #83's affected recipe, and scheduling the two-actor session to close Journey 3.

## Recently shipped

- Iconography replacement: the 22-icon in-app UI set — [PR #90](https://github.com/kraigstrong/Keepsake/pull/90), merged 2026-08-20 — and the generated app-icon assets — [PR #91](https://github.com/kraigstrong/Keepsake/pull/91), merged 2026-08-20. Both from the "Keepsake · Ink & Paper" design handoff. The icon set still wants a real-device look: tests can't judge whether the glyphs read correctly at size.
- Compound parenthetical annotations fix in `parseQuantity()` (+ a Codex-caught whitespace follow-up) — [PR #89](https://github.com/kraigstrong/Keepsake/pull/89), merged 2026-08-20. See `docs/roadmap.md`'s Not-yet-triaged backlog.
- `parseQuantity()` "N and X/Y unit" mixed-number fix + real-world ingredient corpus — [PR #88](https://github.com/kraigstrong/Keepsake/pull/88), merged 2026-08-20. See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Cold-launch onboarding-flash fix + StartupScreen — [PR #87](https://github.com/kraigstrong/Keepsake/pull/87), merged 2026-08-20, confirmed live on-device. See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Cooking Mode Done Cooking double-tap fix — [PR #86](https://github.com/kraigstrong/Keepsake/pull/86), merged 2026-08-20. [PR #85](https://github.com/kraigstrong/Keepsake/pull/85) had merged earlier the same night with only a first, ineffective attempt (an `onPressIn` workaround premised on a root cause later disproven live); #86 superseded it with the actual fix, confirmed working live and independently verified across four rounds of Codex review overnight. See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Smart Meal Selection architecture proposal — [PR #84](https://github.com/kraigstrong/Keepsake/pull/84). See `docs/roadmap.md`'s Unplaced section.
- Period-abbreviated-unit parsing fix — [PR #83](https://github.com/kraigstrong/Keepsake/pull/83). See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Grocery-merge unit-selection bug — [PR #82](https://github.com/kraigstrong/Keepsake/pull/82). See `docs/roadmap.md`'s Not-yet-triaged backlog.
- Structured server error logging — [PR #81](https://github.com/kraigstrong/Keepsake/pull/81), live-verified 2026-08-19. See `docs/roadmap.md`'s Reliability milestone.
- Category-mapping robustness (ORG-04/AI-06) — [PR #79](https://github.com/kraigstrong/Keepsake/pull/79). See `docs/history/phase-08-url-import.md`.
- Orphaned-photo Storage cleanup (T15) — [PR #76](https://github.com/kraigstrong/Keepsake/pull/76). See `docs/threat-model.md`'s T15 entry.
