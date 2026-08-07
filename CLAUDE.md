# Pantry — Agent Operating Instructions

See [`AGENTS.md`](AGENTS.md) for the cross-agent baseline (repo map, security invariants, canonical commands, approval boundaries) — this file adds Claude-specific workflow on top of it.

Pantry is a calm, opinionated recipe app (Expo/React Native + TypeScript, Supabase, Anthropic Claude API server-side). Full product spec: [`docs/prd.md`](docs/prd.md). Full engineering/phase spec: [`docs/execution-plan.md`](docs/execution-plan.md). Read both before doing product work if you haven't already loaded them this session.

Every session, before doing anything else: read [`docs/phase-status.md`](docs/phase-status.md). It says which phase is active, its status, and the next concrete action. Update it before ending a session, or before handing off a decision to the developer.

## How to work

1. **Resume, don't restart.** Use `docs/phase-status.md` and `docs/prd-traceability.md` to pick up where the last session left off rather than re-reading everything from zero.
2. **Vertical slices, incremental commits.** Follow execution-plan.md §2.1, §2.9, §2.10 — multiple small, reviewable, outcome-oriented commits per phase, not one large commit at the end. Commit locally as you go; don't wait for a whole phase to "feel done."
3. **Security ships with the feature, not after it.** Every phase has a security checklist in execution-plan.md. Treat it as part of the build scope, not a follow-up task.
4. **No secrets in Git, ever.** No API keys, service-role credentials, tokens, or `.env` values in any commit, log, fixture, or PR description. Use 1Password CLI / Environments for all secret injection. If you're ever unsure whether something is a secret, treat it as one and ask.
5. **Traceability.** When a PRD requirement (see the ID scheme in execution-plan.md §6) is implemented or tested, update `docs/prd-traceability.md`.
6. **Use the project skills** in [`.claude/skills/`](.claude/skills/) for recurring mechanics: `start-phase`, `exit-phase`, `pr-ready`, `security-check`. They encode the checklists so you don't have to re-derive them each time.
7. **When a phase's build scope looks complete**, run the `exit-phase` skill before declaring it done. A phase is not done because the code exists — it's done when the phase's exit gate has evidence (execution-plan.md §3.6).

## When to interrupt the developer vs. just proceed

Default to acting. Ask (via `AskUserQuestion` in Cowork, or by clearly pausing and stating the question in the CLI) only for:

- A product or design decision the PRD doesn't already answer.
- Phase exit-gate sign-off (Pass / Conditional Pass / Fail) — always a human call.
- Anything touching credentials, secrets, or production/staging access.
- A destructive or hard-to-reverse action outside the current scoped work (schema drops, force-pushes, history rewrites, deleting data).
- A Phase 1 risk-spike result that invalidates an assumption the PRD made.

Everything else — implementation details, library internals, test structure, refactors within scope — proceed without asking.

## Git / PR flow

This environment does not hold push credentials to GitHub. Commit locally on a feature branch as you work. When a commit group or phase is ready for review, say so explicitly and give the exact `git push` command and a PR description (use `.github/PULL_REQUEST_TEMPLATE.md`) — the developer pushes and opens the PR themselves, from a laptop or the GitHub mobile app. Don't silently accumulate uncommitted work waiting for "the end of the phase."

## Non-negotiables from the PRD (execution-plan.md §2.6–2.8, prd.md §30)

- Household isolation is enforced server-side via RLS and Storage policies — never rely on client-side filtering alone.
- All external input (URLs, uploads, deep links, AI output) is untrusted until validated.
- AI must never confidently invent information — uncertain output is flagged, not guessed.
- Destructive operations are reauthorized server-side and idempotent.
