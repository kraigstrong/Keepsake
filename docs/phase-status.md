# Phase Status

The single source of truth for "where are we." Update this at the start and end of every session. Keep entries short — this is a pointer, not a log (commit history and PRs are the log).

## Current

- **Phase:** 1 — Native Feasibility and Risk Spikes
- **Status:** Not started
- **Branch:** _(none yet)_
- **Next action:** Run the `start-phase` skill for Phase 1. Build scope: Safari Share Extension, Apple Reminders, Expo dev-build native configuration, SQLite full-text search, camera/photo access, App Group handoff, durable import submission, keep-awake, invitation deep links, Claude structured extraction. Exit gate: chosen implementation paths exist for all release-blocking native requirements — human validation on physical devices is required (ADR-0003), not just Simulator.
- **Blocked on:** Nothing yet, but expect early friction points needing developer input: an Apple Developer Program membership/Team ID for App Group entitlements (Share Extension ↔ main app handoff), and a physical iOS device for the human-validation step — Simulator can't exercise Share Extension, Reminders, camera capture, or keep-awake meaningfully.

## History

| Phase | Result | Date | Notes |
|---|---|---|---|
| — | — | 2026-07-31 | Repository scaffolded. No product phase started yet. |
| 0 | **Pass** | 2026-08-01 | Product Baseline and Quality Harness. 15 commits + merge via [PR #1](https://github.com/kraigstrong/Keepsake/pull/1). Expo/TS app scaffolded as **Keepsake**; ESLint/Prettier/Jest+RTL; local Supabase + example migration/RLS pgTAP test (caught and fixed a real missing-GRANT bug on first CI run); CI workflow with 4 jobs (lint-and-test, database, gitleaks, npm audit) — all now **required status checks** on `main`; branch protection (PR review required, no direct push, no force-push/delete) configured by the developer; `logError`/`trackEvent` + feature-flag abstractions; threat model, incident-response runbook, release checklist. SEC-01/02/08/09 → `Done (tested)`, verified by green CI on `main` ([run 30715573357](https://github.com/kraigstrong/Keepsake/actions/runs/30715573357)). Known non-blocking follow-ups carried into later phases below. |

## Carried-forward items (not phase-0-blocking, but tracked so they aren't lost)

- **"No server credential in client bundle" CI check** — deferred, currently vacuous (no code references `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` yet). Build once server-side code first exists (Phase 1's Claude call or Phase 3's Edge Functions).
- **1Password CLI wiring into CI** (Service Account + `op run`) — decided in principle, not yet added, since no CI job has needed a real secret until now. Phase 1's Claude structured-extraction risk spike is the natural trigger — it needs `ANTHROPIC_API_KEY` in CI for the first time.
- **1Password SSH agent guidance** — not addressed. Low priority for a single-developer project.
- **Squash-merge is still allowed at the repo level** (branch protection requires PR review + the 4 CI checks, but doesn't forbid squash as a merge method). Not urgent — PR #1 was merged correctly as a real merge commit in practice — but worth tightening if it ever bites.
- **Staging Supabase connectivity** — a real staging project exists (developer-provisioned, `client.env` has the URL/publishable key) but nothing in this repo talks to it yet. Expected: that's Phase 3's job (auth/household), not a Phase 0 gap.
- **Fake-secret detection fixture** — deliberately not built (committing secret-shaped strings to prove a scanner works is itself a bad pattern); trusting gitleaks' maintained ruleset instead.

## Open questions for the developer

None blocking Phase 1 kickoff. Expect the Apple Developer account / physical device questions above to surface once Phase 1's `start-phase` run gets into the Share Extension and App Group work specifically.
