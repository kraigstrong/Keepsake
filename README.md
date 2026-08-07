# Pantry

A calm, opinionated recipe app. iOS, Expo/React Native + TypeScript, Supabase backend, Anthropic Claude API for AI cleanup — server-side only.

Active development, well past scaffolding — see `docs/current.md` for exactly which phase is in progress right now.

## Start here

- [`docs/prd.md`](docs/prd.md) — what we're building and why.
- [`docs/execution-plan.md`](docs/execution-plan.md) — how it gets built, phase by phase, with exit criteria for each.
- [`docs/current.md`](docs/current.md) — where things stand right now and the next concrete action. Check this first. Full phase-by-phase history lives in `docs/history/`.
- [`docs/prd-traceability.md`](docs/prd-traceability.md) — requirement-by-requirement status.
- [`docs/adr/`](docs/adr/) — recorded decisions and their rationale.
- [`AGENTS.md`](AGENTS.md) — cross-agent baseline (repo map, security invariants, commands) any coding agent should work from.
- [`CLAUDE.md`](CLAUDE.md) — operating instructions for Claude sessions working in this repo (commit discipline, when to ask vs. proceed, security rules).

## Working on this project

Development happens through Claude sessions (Cowork or Claude Code) working directly in this repo, following the phased plan in `docs/execution-plan.md`. See `CLAUDE.md` for the full operating model, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the commit/PR mechanics.
