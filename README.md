# Pantry

A calm, opinionated recipe app. iOS, Expo/React Native + TypeScript, Supabase backend, Anthropic Claude API for AI cleanup — server-side only.

This repository is currently process scaffolding only — no application code yet. Phase 0 (repository, CI, tooling, local/staging Supabase) hasn't started.

## Start here

- [`docs/prd.md`](docs/prd.md) — what we're building and why.
- [`docs/execution-plan.md`](docs/execution-plan.md) — how it gets built, phase by phase, with exit criteria for each.
- [`docs/phase-status.md`](docs/phase-status.md) — where things stand right now and the next concrete action. Check this first.
- [`docs/prd-traceability.md`](docs/prd-traceability.md) — requirement-by-requirement status.
- [`docs/adr/`](docs/adr/) — recorded decisions and their rationale.
- [`CLAUDE.md`](CLAUDE.md) — operating instructions for Claude sessions working in this repo (commit discipline, when to ask vs. proceed, security rules).

## Working on this project

Development happens through Claude sessions (Cowork or Claude Code) working directly in this repo, following the phased plan in `docs/execution-plan.md`. See `CLAUDE.md` for the full operating model, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the commit/PR mechanics.

Once Phase 0 lands, this section will include actual setup steps (install, env, local Supabase, running the app).
