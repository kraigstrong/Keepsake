# Contributing

This is effectively a household of one developer plus Claude sessions doing the implementation work, but the discipline below is what keeps that sustainable — treat it as real process, not ceremony.

## The short version

1. Read `docs/current.md` to see what's active, and `docs/roadmap.md` to see what's next.
2. Work on a feature branch, not `main`.
3. Commit in small, coherent, independently-reviewable steps (see `docs/architecture.md`'s "How work happens here") — not one giant commit at the end.
4. No secrets, ever, in any commit — see `CLAUDE.md` and `AGENTS.md`.
5. When a work item is ready, push and open a PR using `.github/PULL_REQUEST_TEMPLATE.md` (the `pr-ready` skill drafts this for you).
6. Review and merge PRs from the GitHub mobile app or a laptop — whichever's convenient.
7. When a work item's implementation looks done, run the `ship-work-item` skill before calling it done — a work item exits on verification and review, not on the code merely existing.

## Decisions

An ADR in `docs/adr/` (see `docs/adr/TEMPLATE.md`) is warranted only if reversing the decision six months from now would take a real migration, an architectural rewrite, a security redesign, or a substantial product change — major vendor/technology choices, auth architecture, persistence/data architecture, security boundaries, infrastructure, or major sync/offline strategy. Routine, easily-reversible choices (library internals, component structure, endpoint design, minor schema evolution, ordinary tooling picks) just need a clear commit message or a short code comment. If you're mid-session and something needs the developer's input, use `AskUserQuestion` (Cowork) or pause and state it clearly (CLI) — see `AGENTS.md`'s critical decision policy for exactly which categories warrant an interruption vs. proceeding with a reasonable default.

## Skills

Recurring mechanics are encoded in `.claude/skills/`:

- `select-work-item` — begin or resume a work item (intake through the decision gate).
- `ship-work-item` — implementation through the human review packet.
- `pr-ready` — package a work item for handoff (push command + PR description).
- `security-check` — run the continuous-security checklist against a change.
