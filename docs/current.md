# Current Status

The single source of truth for "where are we." Update this at the start and end of every session — this is a pointer, not a log. Full phase-by-phase history (design decisions, bugs found, exact commit/test counts) lives in `docs/history/*.md`, one file per phase — read a specific one only when you need that phase's detail, not as part of routine session startup.

Phase 0–11.5's history entries were migrated from the old, single `phase-status.md` largely as-written — some restate reasoning that already lives in their own ADR. Starting with Phase 12, keep new entries short: what shipped, what broke and got fixed, the evidence numbers — link to the ADR for *why* rather than re-narrating it (see `CLAUDE.md`'s "Comments and phase records" rule).

## Current

- **Phase:** 12 — This Week Planning
- **Status:** Not started.
- **Branch:** none yet — start from `main` once Phase 11.5's branch is merged. `phase-11.5-hardening` is ready for PR (Conditional Pass, developer decision, 2026-08-06 — see `docs/history/phase-11.5-import-concurrency.md`).
- **Next action:** Push `phase-11.5-hardening`, open its PR, confirm CI runs pgTAP clean for real, get it merged, then run `start-phase` for Phase 12.
- **Blocked on:** Nothing.

## History

| Phase | Result | Date | Summary |
|---|---|---|---|
| — | — | 2026-07-31 | Repository scaffolded. No product phase started yet. |
| [0](history/phase-00-baseline.md) | Pass | 2026-08-01 | Product Baseline and Quality Harness — Expo/TS scaffold, CI (4 required checks), threat model/runbook/release checklist. |
| [1](history/phase-01-native-risk-spikes.md) | Pass | 2026-08-02 | Native Feasibility and Risk Spikes — 9 risk spikes, each device-verified. |
| [2](history/phase-02-application-shell.md) | Pass | 2026-08-02 | Application Shell and Design Foundation — Expo Router, auth boundary, design tokens/primitives. |
| [3](history/phase-03-household-auth.md) | Conditional Pass | 2026-08-02 | Authentication, Household, and Security Boundary — email OTP, household/invitation RPCs + RLS. |
| [3.5](history/phase-03.5-design-direction.md) | Pass | 2026-08-02 | Design Direction and Visual Iteration — "Ink & Paper" visual pass. |
| [4](history/phase-04-manual-recipe.md) | Conditional Pass | 2026-08-03 | Manual Recipe Vertical Slice — recipe schema/RLS, `save_recipe`, hero image, editor/detail screens. |
| [4.5](history/phase-04.5-doc-maintenance.md) | Pass | 2026-08-03 | Cross-cutting doc maintenance — prd.md/execution-plan.md reconciled against what Phase 4 built. |
| [5](history/phase-05-drafts-versions-conflicts.md) | Conditional Pass | 2026-08-04 | Drafts, Version History, and Edit Conflicts — versioning, drafts, restore, conflict UI. |
| [5.5](history/phase-05.5-optional-password-signin.md) | — (no gate) | 2026-08-04 | Optional Password Sign-in (ADR-0012) — opt-in password alongside OTP. |
| [6](history/phase-06-offline-sync.md) | Pass | 2026-08-03 | Offline Read Model and Synchronization — local SQLite mirror, sync engine, image cache. |
| [7](history/phase-07-library-search.md) | Conditional Pass | 2026-08-04 | Library, Smart Sort, Search, and Filters — FTS5 search, sort, filters. |
| [8](history/phase-08-url-import.md) | Pass | 2026-08-05 | URL Import Foundation — SSRF-hardened fetch, Claude extraction, rate limits. |
| [9](history/phase-09-share-extension.md) | Conditional Pass | 2026-08-05 | Safari Share Sheet and Bulk URL Import — Share Extension, durable outbox, bulk paste. |
| [10](history/phase-10-camera-photo-import.md) | Pass | 2026-08-05 | Camera and Existing Photo Import — vision extraction, preserved original photo. |
| [JSON-LD hint](history/cross-cutting-jsonld-hint.md) | Merged | 2026-08-06 | JSON-LD structured-data import hint (ADR-0019) — cross-cutting, not a numbered phase. |
| [11](history/phase-11-units-scaling.md) | Conditional Pass | 2026-08-05/06 | Units, Scaling, and Quantity Integrity — structured quantities, conversion, scaling UI. |
| [11.5](history/phase-11.5-import-concurrency.md) | Conditional Pass | 2026-08-06/07 | Import Concurrency and Local Data Isolation (ADR-0020) — invitation race, import fencing, household-scoped local data. |

## Carried-forward items (not phase-blocking, but tracked so they aren't lost)

- **`captureFromCamera()` physical-device confirmation** — deliberately deferred by the developer (not forgotten). Low risk: shares its permission/cancel pattern with the already-confirmed `pickExistingPhoto()`.
- **1Password CLI wiring into CI** (Service Account + `op run`) — still not added. Concrete consequence: Phase 1's live Claude-extraction test is `describe.skip`-gated on `ANTHROPIC_API_KEY`, which is never present in CI.
- **1Password SSH agent guidance** — not addressed. Low priority for a single-developer project.
- **Squash-merge is still allowed at the repo level** — not urgent, not yet revisited.
- **Fake-secret detection fixture** — deliberately not built, trusting gitleaks' maintained ruleset instead.
- **`@bacons/apple-targets` dependency-scan exception** — re-run `npm audit` without `--omit=dev` periodically to check whether the upstream `@xmldom/xmldom` finding gets a fix.
- **Local SQLite cache is included in iOS device/iCloud backups** — found in Phase 6 (ADR-0013's "Backup implications" section). `expo-sqlite`'s default location is the backed-up Documents-directory-equivalent, not the (correctly-excluded) cache directory hero images use. Judged low-severity (a rebuildable server mirror, no credentials) and not fixed blind — needs on-device verification of a path-format mismatch before trusting a `Paths.cache` redirect. Still not addressed as of Phase 11.5.
- **Sentry/PostHog accounts** — not yet created; both stay no-ops until the developer adds real `EXPO_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_POSTHOG_KEY` values to the `Keepsake Client` 1Password Environment.
- **Brief onboarding flash on cold launch** — physical-device finding, 2026-08-04: on reload, the "What should we call you?" onboarding screen flashes briefly before correctly landing on This Week for an already-onboarded user. Likely `AuthenticatedRouteBoundary`'s session-then-household loading sequencing. Not urgent — developer's own call to defer. Best fit is probably Phase 18 (Performance, Accessibility, Privacy, Security, and Reliability Hardening).
- **Add/Settings visual redesign** — developer feedback, 2026-08-04: dissatisfied with the current look/feel of the global Add sheet and Settings screen. Developer intends to revisit with a fresh design pass later; no specific phase assigned yet.
- **ORG-04/AI-06 category mapping is coincidence-reliable, not robust** — found at Phase 8 exit review. Import's category assignment is exact-string matching Claude's free-text guess against an 11-value seeded vocabulary Claude is never told about. Worth passing the real category list into the extraction prompt. No phase assigned yet.
- **Staging magic-link email is unusable for real sign-up** — found 2026-08-03. `signInWithOtp` sends Supabase's *default* magic-link template, which only renders a clickable link, not the `{{ .Token }}` code `verifyOtp` expects the user to type. Not blocking phase-by-phase dev testing (bootstrap a test account by hand via Dashboard, then use password sign-in), but a real blocker for any actual new user signing up before launch. Fix: add a custom `magic_link` email template (`supabase/templates/`) surfacing `{{ .Token }}`, and push it to staging.
- **Orphaned original-photo Storage objects (T15, Phase 10, ADR-0017)** — upload-before-processing means a photo upload that succeeds but whose extraction/save fails afterward (or whose client abandons the flow mid-way) leaves an unreferenced object in the `recipe-images` bucket. Not a data-exposure risk, just an accumulating storage-cost item. No cleanup mechanism built yet — Phase 9's 30-day outbox expiry is a plausible pattern to reuse if this becomes a real cost concern in practice.
- **True two-connection concurrency verification (Phase 11.5, ADR-0020)** — the invitation-redemption race (KS-002) and import-claim fencing (KS-004) fixes are provable by pgTAP for their logic, but not for genuine two-connection concurrency, which pgTAP's single-transaction model can't express. Worth a manual staging check (two `psql` sessions racing the same call) before considering threat-model T18/T19 fully closed.

## Open questions for the developer

None currently open.
