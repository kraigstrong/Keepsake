# Release Checklist

Distinct from the per-PR `security-check` skill (which runs on every change that touches a trust boundary) — this is the gate before shipping a build to TestFlight/beta (Phase 19) or the App Store (Phase 20). Placeholder items marked *(Phase N)* don't have anything to check yet at Phase 0; keep them here so the shape of the checklist exists before the first real release, rather than being invented under release pressure.

## Before every release build

- [ ] CI is green on the commit being released: typecheck, lint, format, unit tests, migration apply/reset, RLS/pgTAP tests, secret scan, dependency scan (all jobs in `.github/workflows/ci.yml`).
- [ ] No `Not Started` PRD requirement is claimed as shipped — check `docs/prd-traceability.md` for the requirements this release is supposed to include.
- [ ] `docs/current.md` reflects reality — the active work item's state matches what's actually shipped.
- [ ] Dependency scan has no unresolved high/critical findings in runtime dependencies (`npm audit --omit=dev --audit-level=high`); any accepted moderate findings, and any high/critical findings scoped out via `--omit=dev` (build-tooling-only), are documented in `.github/workflows/ci.yml`, not silently ignored.
- [ ] No secret, credential, or production config value appears anywhere in the diff being released (belt-and-suspenders on top of the CI gitleaks job).

## Credentials and environment *(Phase 0 mechanism, verified every release)*

- [ ] Staging and production point at genuinely separate Supabase projects, not the same project with different table prefixes.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY` are confirmed absent from the client bundle (this is also a Phase 0 CI check — "no server credential in client bundle" — but worth a manual spot-check before a real release, not just trusting the automated one blindly).
- [ ] 1Password `Keepsake Server` values used for this build match what's actually deployed to Supabase's own secret store (`supabase secrets set` output, or equivalent) — not stale from a prior rotation.

## Security *(depth grows as phases land)*

- [ ] Threat model (`docs/threat-model.md`) has been revisited if this release introduces a new trust boundary, not just re-read.
- [ ] RLS/Storage policies verified against production data shape, not only against local/staging fixtures — *(Phase 3+)*.
- [ ] Destructive operations (archive/delete) are confirmed idempotent and server-reauthorized in the release build — *(Phase 16)*.

## Native / platform *(Phase 1+)*

- [ ] Share Extension and Apple Reminders integration tested on a physical device, not just Simulator (ADR-0003 scope).
- [ ] App Store privacy nutrition label matches actual data collection (cross-check against `docs/threat-model.md` §1 assets and the analytics allowlist in `src/observability/trackEvent.ts`).
- [ ] Native permissions requested (camera, notifications if added later) match what's actually used — no unused permission requests.

## Operational readiness *(Phase 19+)*

- [ ] Rollback plan exists and is stated, not assumed — what happens if this release needs to be pulled.
- [ ] Error tracking (Sentry) and analytics (PostHog) are confirmed receiving events from a real build before wide release, not just local dev.
- [ ] Beta/TestFlight feedback channel exists and is monitored.

## Post-release

- [ ] Tag the release in Git.
- [ ] Update the phase's `docs/history/*.md` entry (and `docs/current.md` if this release changes the active work item's state).
- [ ] Smoke-check production immediately after rollout (execution-plan.md §3.5-adjacent operational validation) — don't assume a green CI run before deploy means the deployed build is healthy.
