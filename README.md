# Keepsake

A calm, opinionated recipe app. iOS, Expo/React Native + TypeScript, Supabase backend, Anthropic Claude API for AI cleanup — server-side only. (Some older docs still call it "Pantry" — same app, renamed since; `package.json`'s `name` and this file are the canonical spelling.)

Active development, well past scaffolding — see [`docs/current.md`](docs/current.md) for exactly which phase is in progress right now.

## Start here

- [`docs/prd.md`](docs/prd.md) — what we're building and why.
- [`docs/execution-plan.md`](docs/execution-plan.md) — how it gets built, phase by phase, with exit criteria for each.
- [`docs/current.md`](docs/current.md) — where things stand right now and the next concrete action. Check this first. Full phase-by-phase history lives in `docs/history/`.
- [`docs/prd-traceability.md`](docs/prd-traceability.md) — requirement-by-requirement status.
- [`docs/adr/`](docs/adr/) — recorded decisions and their rationale.
- [`AGENTS.md`](AGENTS.md) — cross-agent baseline (repo map, security invariants, commands) any coding agent should work from.
- [`CLAUDE.md`](CLAUDE.md) — operating instructions for Claude sessions working in this repo (commit discipline, when to ask vs. proceed, security rules).

## Getting started

```bash
npm install
npm run db:start   # local Supabase (Docker) — needed for anything that touches the backend
npm start          # Expo dev server
```

Backend-touching work also needs a local Supabase instance linked and (for AI import) an `ANTHROPIC_API_KEY` — see `CONTRIBUTING.md` and the relevant phase's security notes in `docs/adr/` for secret handling; nothing goes in `.env` files committed to this repo.

Common commands (all in `package.json`):

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run db:reset && npm run db:test   # migrations + pgTAP, needs npm run db:start first
```

## Working on this project

Development happens through Claude sessions (Cowork or Claude Code) working directly in this repo, following the phased plan in `docs/execution-plan.md`. See `CLAUDE.md` for the full operating model, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the commit/PR mechanics.
