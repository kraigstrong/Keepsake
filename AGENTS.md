# Keepsake — Agent Baseline

Cross-agent source of truth. Any coding agent working in this repo — including automated PR review (Codex) — should be able to work from this file alone without loading `docs/prd.md`, `docs/architecture.md`, `docs/roadmap.md`, or the full `docs/history/` archive. Load those only for cross-cutting product/architecture/planning work; for a routine change or review, this file plus the specific files you're touching is enough.

Claude Code specifically should also read [`CLAUDE.md`](CLAUDE.md) for Claude-specific workflow (how to resume a session, the work-item lifecycle, the skills in `.claude/skills/`) — this file is the shared baseline any agent needs, that one is Claude's own operating instructions on top of it.

Keepsake (product name "Pantry" internally in some docs — same app) is a calm, opinionated recipe app: Expo/React Native + TypeScript client, Supabase (Postgres + RLS + Storage + Edge Functions) backend, Anthropic Claude API called server-side only.

## Repo map

- `app/` — Expo Router screens (client).
- `src/` — client logic: `session/` (auth), `household/` (household/profile state), `recipes/` (CRUD, screens), `sync/` (offline SQLite mirror + pull/push), `import/` (Share Extension outbox, batch import), `db/` (local SQLite schema/migrations).
- `server/` — runtime-neutral pure TypeScript, executes under both Node (for Jest) and Deno (the Edge Function): `server/units/` (quantity parsing/scaling), `server/import/` (URL fetch, HTML reduction, JSON-LD extraction), `server/ai/` (Claude extraction calls). No side effects at import time; keep it that way.
- `supabase/functions/import-recipe/` — the one Deno Edge Function. Pinned import map in `deno.json`. Uses the caller's own JWT (never service-role) so RLS applies inside it same as anywhere else.
- `supabase/migrations/` — forward-only SQL migrations. `supabase/tests/database/` — pgTAP tests, one file per migration/RPC group, run for real against Postgres in CI.
- `docs/` — `prd.md` (product spec), `architecture.md` (living system-architecture overview — read this right after this file), `roadmap.md` (milestone outcomes; the backlog lives in GitHub Issues), `execution-plan.md` (historical phase-by-phase build record; the durable process principles that used to live here have moved to `architecture.md`), `history/` (one archive file per phase, load a specific one only when needed), `threat-model.md` (T-numbered entries), `prd-traceability.md` (requirement ID → status), `adr/` (numbered decision records).
- `.claude/skills/` — `select-work-item`, `ship-work-item`, `pr-ready`, `security-check` encode this project's recurring workflows.

## Durable security invariants

These don't change work item to work item — treat a PR that violates one as a blocking finding regardless of what else it does well:

- Household isolation is enforced server-side via RLS and Storage policies. Never rely on client-side filtering alone as the actual authorization boundary.
- All external input — URLs, uploads, deep links, AI output — is untrusted until validated.
- AI must never confidently invent information. Uncertain output is flagged (e.g. `uncertainFields`), not guessed.
- Destructive operations are reauthorized server-side and idempotent.
- No secrets in git, ever — no API keys, service-role credentials, tokens, or `.env` values in any commit, log, fixture, or PR description.
- The Edge Function uses the caller's JWT, not the service-role key. A PR that introduces service-role access into a request path a client can trigger is a hard stop. **One written-down exception exists** — the account-deletion function, whose only privileged call is `auth.admin.deleteUser(id)` with `id` read from the verified JWT and no id parameter anywhere in its interface (ADR-0028). It is a hole with a name and a mechanical check, not a softening of the rule: any *other* function reaching for the key is still a hard stop, and so is a second privileged operation inside that one.

## Canonical commands

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:client-secrets
npm run db:reset && npm run db:test   # pgTAP, needs local Supabase/Docker
```

A PR touching `supabase/migrations/` or `supabase/tests/database/` needs the last one run for real — CI runs it, but note that `supabase/functions/import-recipe` is currently excluded from `tsconfig.json`/`eslint.config.js` (Deno-only code, checked at deploy time, not by the commands above).

Deploying an Edge Function to staging (`supabase functions deploy`) is a separate, credentialed operation — see [`docs/deploying-edge-functions.md`](docs/deploying-edge-functions.md) before attempting it. It is not one of the canonical commands above and is not part of a normal PR.

Rebuilding the native iOS app is likewise not one of these commands, and **none of them build it** — no CI job compiles this app at all. If a native dependency was bumped (Dependabot does this unprompted), the installed pods are stale and the next rebuild fails with a compile error that reads like a library bug. See [`docs/building-ios-locally.md`](docs/building-ios-locally.md) — it also covers the CocoaPods/Ruby incompatibility that makes `pod install` fail while appearing to succeed.

Run the full sequence locally before every push, not a hand-picked subset — CI runs `typecheck`, `lint`, `format:check`, and `test` as four separate steps in that order, and any one of them failing burns a full CI run. Running only the test files you touched, or only `tsc`, is not a substitute for actually running `npm run lint` and `npm run format:check` too (found the hard way: a PR passed targeted tests and typecheck locally but failed CI on `format:check` alone).

## Current-state pointer

Work state lives in **GitHub Issues**, not in any file:

```bash
gh issue list --state open --milestone "Beta" --json number,title,labels,body
```

The issue body carries the acceptance criteria. `Beta` blocks external TestFlight; `Post-beta` does not. `owner:kraig` is developer-only, `blocked:kraig` is waiting on a decision, `verify:*` says whether the item needs the suite, a Simulator, a device, or two devices. An open issue with a linked PR is in flight; a closed issue is done. A Project board exists as a view over these issues — **if a board field and the issue disagree, the issue wins.** An empty result means check the milestone name; `gh` exits 0 for a milestone that does not exist.

Never record work state in a committed file. A PR closes its issue with `Closes #N`.

[`docs/roadmap.md`](docs/roadmap.md) holds milestone outcomes only. Full phase-by-phase history from before the work-item model lives in `docs/history/phase-NN-*.md` — load a specific one only when a task needs that phase's detail. For design rationale, `docs/adr/` is indexed by number and faster to search.

## Delegation

When working through a work item's lifecycle (see `CLAUDE.md`), a subagent is worth spawning for: investigating an unfamiliar subsystem, drafting an ADR once a consequential decision is confirmed real, implementing an approved bounded chunk, or independently verifying an implementation you didn't write yourself. Not worth it for trivial changes, decisions requiring product judgment, or anything needing session context a fresh spawn would have to expensively re-derive — and never for a whole milestone handed over to decompose, implement, and self-approve.

Give a subagent the work item's objective, scope, non-goals, and acceptance criteria; a pointer to this file and `docs/architecture.md` (not the full history); the specific files in scope; and explicit boundary language — don't expand scope, escalate a consequential decision back rather than deciding it. Validate what comes back by inspecting the actual diff or artifact directly. A subagent's summary describes what it intended to do, not necessarily what it did.

## Git / PR flow

Feature branches off `main`, named `<area>/<short-name>`. Push/PR credentials via `gh` are often available in this environment (confirmed 2026-08-19), but default to handing the developer a `git push` command and PR description rather than pushing yourself — only push or open the PR directly when explicitly asked. Either way, expect a branch and an open PR, not direct commits to `main`. PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md`.

## Critical decision policy

Proceed without asking for anything local, reversible, consistent with existing patterns, and inexpensive to change. Escalate to the developer when a decision touches:

- **Product** — new user-facing behavior outside approved scope, removing or altering a requirement, a real UX tradeoff, a change to product semantics.
- **Architecture** — persistence/data-model strategy, auth architecture, sync/offline architecture, new infrastructure, a new major vendor/service, a significant boundary, a hard-to-reverse migration. Same bar as `docs/adr/TEMPLATE.md`'s consequential-decision heuristic — if a decision would need an ADR, it needs a human decision before an agent proceeds on it.
- **Security / Privacy** — auth/authorization behavior, secrets, permissions, data exposure, encryption, privacy-sensitive behavior, meaningfully *weakening* an existing control. Strengthening an already-known, already-accepted gap doesn't need escalation on its own — see `.claude/skills/security-check`.
- **Cost** — a new recurring paid service, a material increase in AI/API/infrastructure usage, an architectural choice that meaningfully changes expected operating cost.
- **Scope** — the work item can't reasonably stay small, implementation needs substantial unrelated work, or acceptance criteria conflict with existing architecture or product.

When escalating: state the decision required, why it matters, the viable options with tradeoffs, and a recommendation — never a bare "I need a decision." `.github/ISSUE_TEMPLATE/decision-needed.md` already has this shape; reuse it. Stop only the blocked portion of the work item — everything else continues.

## Definition of done

A work item is done when: the canonical commands above pass, its security implications have been considered via `.claude/skills/security-check` — not skipped — and `docs/prd-traceability.md` is updated for any PRD requirement ID it provides evidence for. A migration or RPC change additionally needs its pgTAP suite actually run, not just written. An implementation is not done because a subagent reports success — see Delegation above.

## Review priorities for Codex

Three priorities, in order. **Findings are weighted by consequence to a user's data, privacy, security, or ability to use the app** — not by how much of the diff they touch.

1. **Security.** Household/RLS boundary correctness on any new table, column, or RPC — does a query or function actually get scoped by the caller's household, or does it only look like it does? Server-only code crossing into client bundles — a new import in `src/` or `app/` reaching into `server/ai`, `server/import`'s network/secret-touching modules, or anything that would put a credential in the Metro bundle. Any new external-input surface (URL, upload, deep link, AI output) used before validation.
2. **Race conditions and atomicity.** Multi-step `security definer` functions and multi-RPC request handlers — a partial failure between two database calls that should have been one transaction is a recurring defect class here. `docs/adr/0020-import-fencing-and-local-data-isolation.md` (`finalize_import_job`) is the canonical fix pattern: merge the steps into one function, call the existing save/create RPC directly rather than duplicating its body (nested `security definer` calls share the outer transaction), and fence any claim or lease with a token, not just a timestamp. Watch for concurrency assumptions stated in comments but not enforced in SQL — "idempotent" or "single-winner" claims not backed by a unique constraint, row lock, or atomic `UPDATE ... WHERE ... RETURNING`.
3. **Acceptance criteria.** Does the change satisfy the acceptance criteria in the issue it closes — without scope creep, and without silently dropping part of it?

Report findings against real code paths, not the PR diff in isolation — this repo's bugs have mostly been in what a diff *doesn't* touch (a second call site, an existing test that should have caught it, a downstream table). When a finding is one instance of a class, say so and name the other instances; a fix that closes only the named line is the wrong fix.

**Do not report on comment length or documentation weight.** That was previously a listed priority and it produced findings on six of eleven PRs, two of which had no correctness finding at all. Prose style is not a review concern here.

**Scope.** Skip review entirely for routine status and editorial changes. Do review externally binding policy (anything a user or Apple reads), security procedures, and agent-operating instructions — a defect in those has consequences even though no code changed.
