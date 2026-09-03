# Keepsake

A calm, opinionated recipe app. iOS, Expo/React Native + TypeScript, Supabase backend, Anthropic Claude API for AI cleanup — server-side only. (Some older docs still call it "Pantry" — same app, renamed since; `package.json`'s `name` and this file are the canonical spelling.)

Active development, well past scaffolding. What's active, blocked and next lives in GitHub Issues — `gh issue list --state open --milestone "Beta"`. [`docs/roadmap.md`](docs/roadmap.md) holds the milestone outcomes those issues ladder up to.

## Start here

- [`docs/prd.md`](docs/prd.md) — what we're building and why.
- [`docs/architecture.md`](docs/architecture.md) — how the system fits together as it stands today.
- [`docs/roadmap.md`](docs/roadmap.md) — milestone outcomes. No backlog; that lives in GitHub Issues.
- **GitHub Issues** — what's active, blocked and next, with acceptance criteria. Check this first: `gh issue list --state open --milestone "Beta"`. Phase-by-phase history from before the work-item model lives in `docs/history/`.
- [`docs/prd-traceability.md`](docs/prd-traceability.md) — requirement-by-requirement status.
- [`docs/adr/`](docs/adr/) — recorded decisions and their rationale.
- [`AGENTS.md`](AGENTS.md) — cross-agent baseline (repo map, security invariants, commands, critical decision policy) any coding agent should work from.
- [`CLAUDE.md`](CLAUDE.md) — operating instructions for Claude sessions working in this repo (the work-item lifecycle, when to ask vs. proceed, security rules).

## Getting started

```bash
npm install
npm run db:start   # local Supabase (Docker) — needed for anything that touches the backend
npm start          # Expo dev server
```

Backend-touching work also needs a local Supabase instance linked and (for AI import) an `ANTHROPIC_API_KEY` — see `CONTRIBUTING.md` and the relevant security notes in `docs/adr/` for secret handling; nothing goes in `.env` files committed to this repo.

Rebuilding the **native** iOS app — needed after a native-dependency bump, including one from Dependabot — is a separate operation with two environment traps that don't announce themselves: see [`docs/building-ios-locally.md`](docs/building-ios-locally.md) before running `expo run:ios`. Day-to-day JS work needs none of it.

Common commands (all in `package.json`):

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run db:reset && npm run db:test   # migrations + pgTAP, needs npm run db:start first
```

## Working on this project

Development happens through Claude sessions (Cowork or Claude Code) working directly in this repo, one work item at a time from the GitHub Issues backlog. See `CLAUDE.md` for the full operating model, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the commit/PR mechanics.
