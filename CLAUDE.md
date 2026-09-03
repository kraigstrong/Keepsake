# Pantry — Agent Operating Instructions

See [`AGENTS.md`](AGENTS.md) for the cross-agent baseline (repo map, durable security invariants, canonical commands, critical decision policy) — this file adds Claude-specific workflow on top of it. Security invariants live there only, not restated here.

Pantry is a calm, opinionated recipe app (Expo/React Native + TypeScript, Supabase, Anthropic Claude API server-side). Full product spec: [`docs/prd.md`](docs/prd.md). System architecture: [`docs/architecture.md`](docs/architecture.md). What's next: [`docs/roadmap.md`](docs/roadmap.md). Read all three before doing product or cross-cutting work if you haven't already loaded them this session.

Every session, before doing anything else: find the selected work item in GitHub Issues.

```bash
gh issue list --state open --milestone "Beta" --json number,title,labels,body
```

The issue body carries the acceptance criteria. `Beta` blocks external TestFlight; `Post-beta` does not. `owner:kraig` is developer-only, `blocked:kraig` is waiting on a decision, `verify:*` says what verification the item needs. **Do not record work state in a file** — the issue is the record, and a PR closes it with `Closes #N`.

## The work-item lifecycle

Keepsake development follows **Product Vision → Milestone → Work Item → Execution**. A milestone (`docs/roadmap.md`) is a roadmap construct, never handed to an agent as a single execution instruction — always work through one specific selected work item. Delegating a piece of it doesn't transfer accountability: whoever starts a work item stays responsible for it end to end.

1. **Intake.** Read the selected work item and relevant context (`AGENTS.md`, `docs/architecture.md`, the specific files in scope). Confirm objective, scope, non-goals, acceptance criteria. If it isn't small enough to stay independently reviewable, say so and recommend a split before starting.
2. **Investigation / planning.** Delegate to a subagent only when it earns its keep (an unfamiliar subsystem, a real design choice) — see `AGENTS.md`'s Delegation section. For routine, well-precedented work, plan inline. Keep the output transient (a `TaskCreate` list or a short in-session note), not a committed file by default.
3. **Plan review.** Never delegated — read the proposed approach adversarially. Is there a simpler solution? Does it match existing architecture? Is scope actually constrained? Proceeding because a subagent "returned successfully" is not sufficient on its own.
4. **Decision gate.** Apply `AGENTS.md`'s critical decision policy. Nothing consequential: proceed. Consequential but not human-owned: draft the minimum artifact (an ADR only if it clears `docs/adr/TEMPLATE.md`'s bar), review it yourself, then proceed. Human-owned: escalate using `.github/ISSUE_TEMPLATE/decision-needed.md`'s shape, stopping only the blocked portion.
5. **Implementation.** Delegate the approved scope to a bounded subagent, or implement directly for a trivial item. Follow existing conventions, add tests, no unrelated refactoring, no documentation beyond what's genuinely durable. The implementer escalates a consequential decision it discovers mid-work rather than deciding it.
6. **Independent verification, scaled to risk.** Assume the implementation may be wrong. A trivial change can go straight to step 7 on the main agent's own read. Anything touching RLS, auth, external input, destructive operations, or a migration gets a genuinely separate look — a fresh subagent that didn't write the code, or `/code-review` — checking correctness, tests, regressions, security, and scope creep against the acceptance criteria. Run `.claude/skills/security-check` whenever the touched categories match its trigger list.
7. **Final review.** Read the actual diff, tests, and verification findings directly — not a summary of a summary. Approve, request a targeted fix (then re-verify just the affected behavior, don't restart the whole lifecycle), escalate, or split remaining work into a new work item rather than silently expanding this one.
8. **Human review packet.** What changed, why, what verification ran and found, risks/limitations, follow-up work items discovered. Give the exact `git push` command and a PR description (`.github/PULL_REQUEST_TEMPLATE.md`) — the developer pushes and opens the PR themselves, unless they've explicitly asked you to do it (see Git / PR flow, below).

`.claude/skills/select-work-item` covers steps 1–4. `.claude/skills/ship-work-item` covers 5–8.

## How to work

1. **Resume, don't restart.** Use the open issues to pick up where the last session left off rather than re-reading everything from zero.
2. **Vertical slices, incremental commits.** Multiple small, reviewable, outcome-oriented commits per work item, not one large commit at the end (see `docs/architecture.md`'s "How work happens here"). Commit locally as you go; don't wait for a work item to "feel done."
3. **Security ships with the feature, not after it.** Any work item touching a trust boundary gets `.claude/skills/security-check` as part of the work, not a follow-up task.
4. **No secrets in Git, ever.** No API keys, service-role credentials, tokens, or `.env` values in any commit, log, fixture, or PR description. Use 1Password CLI / Environments for all secret injection. If you're ever unsure whether something is a secret, treat it as one and ask.
5. **Traceability.** When a PRD requirement is implemented or tested, update `docs/prd-traceability.md`.
6. **Use the project skills** in [`.claude/skills/`](.claude/skills/) for recurring mechanics: `select-work-item`, `ship-work-item`, `pr-ready`, `security-check`. They encode the checklists so you don't have to re-derive them each time.
7. **Comments and history entries point to reasoning, they don't repeat it.** When an ADR already exists for a decision, a code comment cites it (`ADR-0020`) and states only the one non-obvious consequence at that call site — it doesn't re-derive the whole decision inline. If a comment is getting longer than the code it explains, that's the signal to cut it down and link out instead of writing more.

## Git / PR flow

Commit locally on a feature branch as you work. Don't silently accumulate uncommitted work waiting for "the end of the work item." When a work item is ready for review, say so explicitly and give the exact `git push` command and a PR description (use `.github/PULL_REQUEST_TEMPLATE.md`) so the developer can push and open the PR themselves, from a laptop or the GitHub mobile app. Push/PR credentials via `gh` are often available in this environment too (confirmed 2026-08-19) — but don't push or open a PR yourself unless the developer explicitly asks (in chat, or via an explicit UI action like a "Create PR" command); default to handing off the command and description.
