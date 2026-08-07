# Contributing

This is effectively a household of one developer plus Claude sessions doing the implementation work, but the discipline below is what keeps that sustainable — treat it as real process, not ceremony.

## The short version

1. Read `docs/current.md` to see what's current.
2. Work on a feature branch, not `main`.
3. Commit in small, coherent, independently-reviewable steps (see execution-plan.md §2.9–§2.10) — not one giant commit at the end.
4. No secrets, ever, in any commit — see `CLAUDE.md` and execution-plan.md §2.7.
5. When a commit group is ready, push and open a PR using `.github/PULL_REQUEST_TEMPLATE.md` (the `pr-ready` skill drafts this for you).
6. Review and merge PRs from the GitHub mobile app or a laptop — whichever's convenient.
7. When a phase's build scope looks done, run the `exit-phase` skill before calling it done. A phase exits on evidence (tests, PRD traceability, security review, device demonstration per ADR-0003), not on the code merely existing.

## Decisions

Non-trivial technical or product decisions not already settled by the PRD get a short ADR in `docs/adr/` (see `docs/adr/TEMPLATE.md`). If you're mid-session and something needs the developer's input, use `AskUserQuestion` (Cowork) or pause and state it clearly (CLI) — see `CLAUDE.md` for exactly which categories warrant an interruption vs. proceeding with a reasonable default.

## Skills

Recurring mechanics are encoded in `.claude/skills/`:

- `start-phase` — begin or resume a phase.
- `exit-phase` — run the exit-gate review and produce the Phase Completion Report.
- `pr-ready` — package a commit group for handoff (push command + PR description).
- `security-check` — run the continuous-security checklist against a change.
