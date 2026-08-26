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
- `docs/` — `prd.md` (product spec), `architecture.md` (living system-architecture overview — read this right after this file), `roadmap.md` (milestones and work-item backlog — what's still left to build), `current.md` (current-state pointer — see below), `execution-plan.md` (historical phase-by-phase build record; the durable process principles that used to live here have moved to `architecture.md`), `history/` (one archive file per phase, load a specific one only when needed), `threat-model.md` (T-numbered entries), `prd-traceability.md` (requirement ID → status), `adr/` (numbered decision records).
- `.claude/skills/` — `select-work-item`, `ship-work-item`, `pr-ready`, `security-check` encode this project's recurring workflows.

## Durable security invariants

These don't change work item to work item — treat a PR that violates one as a blocking finding regardless of what else it does well:

- Household isolation is enforced server-side via RLS and Storage policies. Never rely on client-side filtering alone as the actual authorization boundary.
- All external input — URLs, uploads, deep links, AI output — is untrusted until validated.
- AI must never confidently invent information. Uncertain output is flagged (e.g. `uncertainFields`), not guessed.
- Destructive operations are reauthorized server-side and idempotent.
- No secrets in git, ever — no API keys, service-role credentials, tokens, or `.env` values in any commit, log, fixture, or PR description.
- The Edge Function uses the caller's JWT, not the service-role key. A PR that introduces service-role access into a request path a client can trigger is a hard stop.

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

Run the full sequence locally before every push, not a hand-picked subset — CI runs `typecheck`, `lint`, `format:check`, and `test` as four separate steps in that order, and any one of them failing burns a full CI run. Running only the test files you touched, or only `tsc`, is not a substitute for actually running `npm run lint` and `npm run format:check` too (found the hard way: a PR passed targeted tests and typecheck locally but failed CI on `format:check` alone).

## Current-state pointer

Read [`docs/current.md`](docs/current.md) — short by design — for what work item is actively selected right now and its state. [`docs/roadmap.md`](docs/roadmap.md) holds the milestone/backlog layer (what's next, in priority order); `docs/current.md` is only what's actually in flight this session. Full phase-by-phase history from before the work-item model lives in `docs/history/phase-NN-*.md`, one file per phase — load a specific one only when a task needs that phase's detail. If you need design rationale rather than a phase narrative, `docs/adr/` is indexed by number and faster to search.

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

Codex reviews every PR on this repo. In priority order:

1. **Security.** Household/RLS boundary correctness on any new table, column, or RPC — does a query or function actually get scoped by the caller's household, or does it only look like it does? Server-only code crossing into client bundles — a new import in `src/` or `app/` reaching into `server/ai`, `server/import`'s network/secret-touching modules, or anything that would put a credential in the Metro bundle. Any new external-input surface (URL, upload, deep link, AI output) used before validation.
2. **Maintainability.** Prefer this repo's established patterns over a new one for the same problem — pure runtime-neutral modules in `server/`, one RPC per write boundary, an ADR recorded before a non-obvious consequential decision, not after (see `docs/adr/TEMPLATE.md`'s bar — routine decisions don't need one at all). Flag complexity that isn't earning its keep, and duplicated logic that should be one shared call site instead. This includes comment and doc weight: a comment that re-derives an ADR's whole decision inline instead of citing it, or that's grown longer than the code it explains, is a maintainability finding — flag it the same as any other unearned complexity.
3. **Race conditions.** Atomicity of multi-step `security definer` functions and multi-RPC request handlers — a partial failure between two separate database calls that should have been one transaction is a recurring defect class in this repo; `docs/adr/0020-import-fencing-and-local-data-isolation.md` (`finalize_import_job`) is the canonical fix pattern to compare against: merge the steps into one function, call the existing save/create RPC directly rather than duplicating its body (nested `security definer` calls share the outer transaction), and fence any claim/lease with a token, not just a timestamp. Also watch for concurrency assumptions stated as comments but not enforced in SQL — "idempotent" or "single-winner" claims that aren't backed by a unique constraint, row lock, or atomic `UPDATE ... WHERE ... RETURNING`.
4. **Product requirements.** Does the change actually satisfy the PRD requirement ID(s) it claims (`docs/prd-traceability.md`), and does it match the work item's own stated acceptance criteria — not scope-creeping beyond it or silently dropping part of it?

Report findings against real code paths, not the PR diff in isolation — this repo's bugs have mostly been in what a diff *doesn't* touch (a second call site, an existing test that should have caught it, a downstream table).
