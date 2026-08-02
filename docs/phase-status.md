# Phase Status

The single source of truth for "where are we." Update this at the start and end of every session. Keep entries short — this is a pointer, not a log (commit history and PRs are the log).

## Current

- **Phase:** 2 — Application Shell and Design Foundation
- **Status:** Not started
- **Branch:** _(none yet)_
- **Next action:** Run the `start-phase` skill for Phase 2. Build scope: Expo Router, This Week and Library tabs, Settings access, global add action, design tokens, core components (buttons/rows/chips/sheets/alerts/toasts), empty/loading/error/offline states, image placeholder, Dynamic Type, Reduced Motion, VoiceOver conventions, secure session storage, authenticated route boundary, sign-out state clearing, redacted logging, analytics event allowlist. Exit gate: shell is accessible, secure, reusable, and ready for vertical slices.
- **Blocked on:** Nothing.

## History

| Phase | Result | Date | Notes |
|---|---|---|---|
| — | — | 2026-07-31 | Repository scaffolded. No product phase started yet. |
| 0 | **Pass** | 2026-08-01 | Product Baseline and Quality Harness. 15 commits + merge via [PR #1](https://github.com/kraigstrong/Keepsake/pull/1). Expo/TS app scaffolded as **Keepsake**; ESLint/Prettier/Jest+RTL; local Supabase + example migration/RLS pgTAP test (caught and fixed a real missing-GRANT bug on first CI run); CI workflow with 4 jobs (lint-and-test, database, gitleaks, npm audit) — all now **required status checks** on `main`; branch protection (PR review required, no direct push, no force-push/delete) configured by the developer; `logError`/`trackEvent` + feature-flag abstractions; threat model, incident-response runbook, release checklist. SEC-01/02/08/09 → `Done (tested)`, verified by green CI on `main` ([run 30715573357](https://github.com/kraigstrong/Keepsake/actions/runs/30715573357)). Known non-blocking follow-ups carried into later phases below. |
| 1 | **Pass** | 2026-08-02 | Native Feasibility and Risk Spikes. 10 commits on `phase-1-native-risk-spikes` ([PR #12](https://github.com/kraigstrong/Keepsake/pull/12)). Nine risk spikes, each verified on both Simulator and a physical device (real evidence, not assertions) documented in `docs/risk-spikes/`: dev-client native build, SQLite FTS (title-ranking via bm25 flagged unsolved, Phase 7 follow-up), invitation deep links, Claude structured extraction (real live API call), keep-awake (screen genuinely stays on, device-confirmed), camera/photo import (photo-library path device-confirmed; live camera capture explicitly deferred by the developer, not blocking), Apple Reminders (real EventKit list+item, device-confirmed), App Group handoff (real shared-container round-trip, device-confirmed with a real provisioning profile), and a real Safari Share Extension (real Share Sheet → extension → App Group → app, device-confirmed with a real URL). One real UX finding from the device pass: the Share Extension's confirmation state (0.6s) is too brief to register — "it just disappeared... but the data was sent" — mechanism works, felt experience doesn't yet match the PRD's calm ethos; captured in `docs/risk-spikes/safari-share-extension.md` as a named Phase 9 follow-up, not silently dropped. Also produced a durable-import-submission design doc naming a real gap (single-file overwrite on repeat shares) and its fix path, deliberately deferred to Phase 8/9. Typecheck/lint/format/test all clean (10 suites, 57 passed, 1 skipped); `npm audit --omit=dev --audit-level=high` exit 0; all 4 CI checks green on the PR after fixing two real issues surfaced there (npm-version-dependent lockfile drift, a gitleaks false positive on a fabricated test token — both detailed below). Added `@bacons/apple-targets` as a devDependency (needed to generate the Share Extension Xcode target so it survives `expo prebuild`); it carries an unresolved high-severity `@xmldom/xmldom` finding in its own build-time-only tree, scoped out of the dependency-scan gate via `--omit=dev` after explicit discussion with the developer — see `docs/threat-model.md` T8. |

## Carried-forward items (not phase-blocking, but tracked so they aren't lost)

- **Share Extension confirmation-state UX** — physical-device finding: the "Saved to Keepsake" state (0.6s) is too brief to register as a real confirmation. Phase 9 ("Final Share Extension") should evaluate a longer/more legible confirmation, a success icon, or haptics. See `docs/risk-spikes/safari-share-extension.md`.
- **`captureFromCamera()` physical-device confirmation** — deliberately deferred by the developer (not forgotten). Low risk: shares its permission/cancel pattern with the already-confirmed `pickExistingPhoto()`. Worth a quick check before Phase 10 builds on top of it.
- **"No server credential in client bundle" CI check** — deferred since Phase 0, now more overdue: `server/ai/extractRecipe.ts` references `ANTHROPIC_API_KEY` as of Phase 1, so server-side code referencing a real secret now exists and this check is no longer vacuous. Build before Phase 3's Edge Functions add more server-side secret usage.
- **1Password CLI wiring into CI** (Service Account + `op run`) — still not added. Concrete consequence now visible: Phase 1's live Claude-extraction test (`server/ai/extractRecipe.test.ts`) is `describe.skip`-gated on `ANTHROPIC_API_KEY` being present, which it never is in CI — so CI has never actually exercised the real Anthropic API call, only the schema-only tests. Worth prioritizing before this gap widens further.
- **1Password SSH agent guidance** — not addressed. Low priority for a single-developer project.
- **Squash-merge is still allowed at the repo level** — not urgent, not yet revisited.
- **Staging Supabase connectivity** — still Phase 3's job, not yet relevant.
- **Fake-secret detection fixture** — deliberately not built, trusting gitleaks' maintained ruleset instead.
- **`@bacons/apple-targets` dependency-scan exception** — re-run `npm audit` without `--omit=dev` periodically to check whether the upstream `@xmldom/xmldom` finding gets a fix.

## Open questions for the developer

None blocking Phase 2 kickoff.
