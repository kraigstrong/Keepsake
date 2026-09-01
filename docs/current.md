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

**All four Friends & Family Preview gates are now closed or credential-blocked; none needs code** (2026-08-28):

1. `"1 cup (2 sticks)"` scaling — **closed.** Parser fixed ([#112](https://github.com/kraigstrong/Keepsake/pull/112), [#119](https://github.com/kraigstrong/Keepsake/pull/119)), stored data backfilled on staging (see Blocked above).
2. Weekly-plan locking — **closed** ([#113](https://github.com/kraigstrong/Keepsake/pull/113)), with the concurrency evidence gap recorded rather than pretended away.
3. Telemetry — **credentials obtained 2026-08-29**, both in the Keepsake Client 1Password Environment. Instrumentation was already done ([#115](https://github.com/kraigstrong/Keepsake/pull/115), [#116](https://github.com/kraigstrong/Keepsake/pull/116)). What is left is not code and not credentials: confirming events actually arrive, which needs a real build, so it merges into the archive below rather than standing as its own gate. Both providers are free-forever tiers (Sentry Developer, PostHog free) — no recurring cost decision. Note Sentry's free plan silently drops events past 5k/month, whose only realistic trigger at this scale is a crash loop, i.e. exactly when you need them.
4. "Help me choose" overlapping the add FAB on an empty week — **closed** ([#123](https://github.com/kraigstrong/Keepsake/pull/123)).

**Pre-preview security audit ran 2026-08-28 — no Critical or High findings.** Full pgTAP suite (478 tests, 29 files) against a from-scratch reset, full Jest suite, gitleaks over all 593 commits, `npm audit`. Six Low findings; three fixed on `security/preview-audit-fixes` (cooking-note length cap, the dev-credential guard in `check:client-secrets`, Sentry breadcrumb URL scrubbing), three recorded in `docs/roadmap.md` rather than fixed (secureFetch's IPv6 hardening gap, account deletion, and the one below). Evidence and reasoning live in `docs/threat-model.md` and milestone 3's backlog — don't re-derive them.

**Build 3 is uploaded** (`52a7161`), carrying the invite deep-link route ([#134](https://github.com/kraigstrong/Keepsake/pull/134)) and the startup-hang fix ([#135](https://github.com/kraigstrong/Keepsake/pull/135)) that build 2 predated. The startup fix was verified on a real device — airplane mode shows "Couldn't load your household" with a working Try again rather than spinning forever. **The invite check was not** — see below. `npm run archive:prep` runs the pre-archive sequence and checks the generated project, so the `CFBundleVersion` mismatch that would otherwise surface at upload is caught in seconds.

**Build 3's invite link is broken for every real invitee — blank screen.** Fixed in [#139](https://github.com/kraigstrong/Keepsake/pull/139); the invitee's staging account, created when she gave up and signed up instead, has been removed. Carry forward one rule: **verify an invite flow from a device that has never joined a household, or you have verified nothing** — build 3's check passed from an already-onboarded phone, the one state where the bug can't reproduce. Full account, including two schema findings that block `docs/roadmap.md`'s account-deletion item: [`docs/history/cross-cutting-invite-blank-screen.md`](history/cross-cutting-invite-blank-screen.md).

**Build 4 is prepared but not archived (2026-09-01).** `ios.buildNumber` is 4 on `release/build-4`; its only functional content is #139. The archive itself is developer-only — `npm run archive:prep` then Xcode — and it is the gate on three separate Phase A items that all need a real build and none of which need more code first: the **two-person invite test** (from a device that has never joined a household), the **six-screen keyboard survey**, and **confirming Sentry receives an event** (its DSN has never been observed working, and an empty dashboard is indistinguishable from a broken one). Walk all three on this build rather than spending a build on each.

**Hosted auth settings — checked 2026-08-29, one thing fixed.** Read in full via the Management API rather than the dashboard. `password_min_length` was 6 while `docs/threat-model.md` T11 claimed 8; raised, and now declared in `[remotes.staging.auth]` so it is reproducible. Otherwise clean: anonymous sign-ins off, manual linking off, OTP 6 digits, Resend SMTP wired, rate limit 30/hour. `npm run check:drift` now asserts the security-relevant ones so this does not have to be re-derived by hand.

**Correction to what this file used to say here.** It framed open signup plus no email confirmation as letting "anyone with the publishable key create an unverified account". Overstated: `signInWithOtp` is the only signup path, so an account requires receiving a code at a real inbox — accounts are email-verified by construction, and `enable_confirmations` governs a password-signup flow this app does not use. The residual risk is junk accounts landing in isolated empty households, not unverified ones.

**Next up is Phase A: you and your wife on TestFlight, one shared household** — see `docs/roadmap.md`'s milestone 5 "Rollout plan", which splits this milestone into a two-person Phase A and a wider Phase B so that Beta App Review's requirements (privacy policy, reviewer account) stop blocking the near step. Tester route decided 2026-08-29: **internal TestFlight**, which is what makes that split possible.

**Phase A's first two blockers are done as of 2026-08-29.** Two migrations had never reached staging — `20260827120000` (weekly-plan locking, gate 2's own fix, recorded as closed while never applied to the hosted database) and `20260828100000` (cooking-note cap); both are now applied and `supabase migration list` shows staging matching local across all 60. Build 2 is archived, uploaded and installed, carrying the fixes in [#128](https://github.com/kraigstrong/Keepsake/pull/128) that `v1.0.0` predated. **Active blocker is now adding testers in App Store Connect.**

**On the invite ordering — the constraint is narrower than first written.** The irreversible step is pressing **"Create a household"**, not opening the app. `app/onboarding.tsx` only renders the household step; `createHousehold` fires from that button alone, and a link arriving while she sits on that screen is auto-accepted. She can install, open, and set a display name safely.

**The long pole is now the real EAS/Xcode build**, and it is underweighted as a plain backlog item: you cannot put this on anyone else's phone without one, it has Apple-side lead times nobody here controls, and no CI job has ever built this app — so the first real build is also where you find out what is broken about building it.

**Nothing else blocks it as of 2026-08-29.** Build path decided: **local Xcode archive → TestFlight internal testing**, with EAS deferred to a separate later decision — the first build of an app that has never been archived has enough unknowns without a new toolchain being one of them. TestFlight internal needs no UDIDs and no Beta App Review. Preparation is merged ([#126](https://github.com/kraigstrong/Keepsake/pull/126)): `npm run archive:env` writes an archive-safe `.env.local` and refuses if a dev credential could reach the bundle, and `docs/building-ios-locally.md` now carries the ordering. The remaining prerequisite is Apple-side and developer-only: a **distribution certificate and an App Store Connect record** for `com.kraigstrong.keepsake` — only an Apple *Development* identity exists today.

Two smaller things worth doing before invites: **Journey 3** (shared-household two-actor walkthrough, still never done — friends and family are exactly the people who will share a household), and the **repository-history secret scan** from milestone 3, which is cheap now and awkward to discover late.

Walkthrough #3 (2026-08-27) went well and its one finding — the deck's stale-image flash — is fixed and merged ([#110](https://github.com/kraigstrong/Keepsake/pull/110), [#111](https://github.com/kraigstrong/Keepsake/pull/111)); see the phase-18 history, which is worth reading for how the first two attempts were aimed at the wrong layer. Terminal states were judged fine as they are, with a look-and-feel pass logged to milestone 4's backlog instead.

Still unanswered from that walkthrough, needing a device session rather than a decision:

- **Refill deck quality** — the one thing no test can answer. Appended candidates are scored against a pool excluding everything already in the deck, so on a small library the second batch is by definition what scored worst first time. Whether that reads as "more good options" or "the dregs" needs eyes on real cards.
- Then reassess the group flow, and **settle whether the beta ships solo-only** (`docs/roadmap.md`'s open question) — a developer decision that shapes how much of milestone 4 remains.

Known and deferred, don't re-report: a lost response on "Select more" can append a second batch (no duplicates, just a longer deck) — logged in `docs/roadmap.md`'s Not-yet-triaged.

**Working method worth keeping:** delegate a slice with the ADR as spec and *named required mutations*, then review the real diff and re-run the mutations independently. Four times on milestone 4 a guard was correct while no test pinned it — see the phase-18 history for the cases. A green suite is not evidence of coverage.

Also queued, unrelated: five untriaged backlog entries.
