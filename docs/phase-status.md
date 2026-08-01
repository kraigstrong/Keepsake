# Phase Status

The single source of truth for "where are we." Update this at the start and end of every session. Keep entries short — this is a pointer, not a log (commit history and PRs are the log).

## Current

- **Phase:** 0 — Product Baseline and Quality Harness
- **Status:** In progress — substantial progress landed, not exit-ready yet (see remaining items below)
- **Branch:** `phase-0-baseline` (11 commits, not yet pushed — this sandbox has no GitHub push credentials; see `pr-ready` skill for the push command once ready)
- **Blocked on:** Nothing that needs the developer right now, but two items below need developer action (branch protection, GitHub repo merge-method setting) since this sandbox can't reach GitHub's admin API.

### Done this session (2026-07-31)

- ADR-0005 (package manager: npm, TS strict, ESLint/Prettier, Jest+RTL, CI: GitHub Actions) and ADR-0006 (Sentry/PostHog/in-house feature flags) — the tooling choices Phase 0 delegates to itself.
- Expo/TypeScript app scaffolded as **Keepsake** (confirmed as the real product name, not the PRD's "Pantry" placeholder — see the `docs: rename Pantry to Keepsake` follow-up task spawned this session, not yet run).
- ESLint + Prettier, Jest (jest-expo) + React Native Testing Library, all verified green.
- Local Supabase project (`supabase init`), one example migration + pgTAP RLS test proving the migration/RLS/test pattern. **Not executed locally** — no reachable Docker daemon in this sandbox — first real execution happens in CI.
- CI workflow (`.github/workflows/ci.yml`): lint-and-test, database (migration apply + reset + pgTAP), secret-scan (gitleaks-action), dependency-scan (npm audit, fails only on high/critical). **Not yet run for real** — needs a push to trigger it.
- `client.env`/`server.env` (1Password mount files) added to `.gitignore` — they weren't covered by any pattern before and were only safe because git can't track named pipes.
- `logError`/`trackEvent` abstraction (no-op stubs; real Sentry/PostHog wiring is Phase 2's job per ADR-0006) and an in-house feature-flag utility (`isEnabled`), both with real passing tests.
- `docs/threat-model.md`, `docs/incident-response.md`, `docs/release-checklist.md` added. The fourth Phase 0 checklist item ("security review checklist") already existed as the `security-check` skill from the initial scaffold.
- `docs/prd-traceability.md`: SEC-01, SEC-02, SEC-08, SEC-09 → `Done (untested)` (mechanism exists, not yet verified by a real CI run); SEC-05, SEC-10 → `In Progress`.
- Web support (`react-dom`, `react-native-web`) added as an internal dev aid per ADR-0002 — verified with a real `expo export --platform web` (builds cleanly).
- `docs/prd.md` / `docs/execution-plan.md`: import pipeline now explicitly requires text-only content reduction before any AI call (cost + prompt-injection surface), from earlier in this session.

### Remaining before Phase 0 can actually exit

Roughly ordered by how soon each one matters:

1. **Push `phase-0-baseline` and let CI actually run.** Everything CI-shaped above (migrations, pgTAP, gitleaks, npm audit) has only been verified locally/by YAML validation, not by a real GitHub Actions run. This is the single most important next step — several things above are "should work" until this happens.
2. **GitHub repo settings (developer action, not reachable from this sandbox):**
   - Branch protection: require the CI workflow's checks before merge to `main`.
   - Merge method: use regular merge commits for PRs, not squash-merge — execution-plan.md §2.11 explicitly wants phase history preserved as multiple commits, and squash-merge defeats that regardless of how carefully commits were made.
3. **"No server credential in client bundle" CI check** — listed in Phase 0's automated validation but not built. Deferred because it's currently vacuous: no code anywhere references `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` yet (that starts in Phase 1/3), so there's nothing for the check to catch. Build it when server-side code (Edge Functions) first exists.
4. **1Password CLI wiring into CI** — discussed and decided earlier this session (1Password Service Account + `op run` via the official GitHub Action), but not actually added to `ci.yml`, because nothing in current CI needs a real secret. Add it when Phase 1's Claude API risk-spike (or anything else) first needs `ANTHROPIC_API_KEY` in a CI job.
5. **Staging Supabase connectivity** — the developer already created a real staging Supabase project and has `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` mounted locally via `client.env`, but no code in this repo actually connects to it yet (no Supabase client instantiated) — that's Phase 3's job (auth/household). Local Supabase (this session's work) and staging Supabase (developer's setup) are both ready; nothing wires them together yet, which is expected at this point.
6. **1Password SSH agent guidance** — not addressed this session. Low priority for a single-developer project; revisit if a second contributor joins.
7. **Fake-secret detection fixture** — deliberately not built (committing secret-shaped strings to prove a scanner works is itself a bad pattern); trusting gitleaks' maintained ruleset instead, see the "Wire up secret and dependency scanning" commit for the full reasoning.

### Next action

Push `phase-0-baseline`, watch the CI run, fix anything that surfaces (most likely candidate: the pgTAP test or `supabase db reset`, since neither ran locally). Once CI is green for real, work through the "Remaining" list above in order, then run the `exit-phase` skill.

## History

| Phase | Result | Date | Notes |
|---|---|---|---|
| — | — | 2026-07-31 | Repository scaffolded. No product phase started yet. |
| 0 | In progress | 2026-07-31 | See "Done this session" / "Remaining" above. |

## Open questions for the developer

None blocking. Two GitHub repo-settings changes are needed from the developer directly (see "Remaining" #2 above) since this sandbox has no admin API access to make them itself.
