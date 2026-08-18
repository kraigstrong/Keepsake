# Keepsake — Agent Baseline

Cross-agent source of truth. Any coding agent working in this repo — including automated PR review (Codex) — should be able to work from this file alone without loading `docs/prd.md`, `docs/execution-plan.md`, or the full `docs/history/` archive. Load those only for cross-cutting product/architecture work; for a routine change or review, this file plus the specific files you're touching is enough.

Claude Code specifically should also read [`CLAUDE.md`](CLAUDE.md) for Claude-specific workflow (how to resume a session, when to interrupt the developer, the skills in `.claude/skills/`) — this file is the shared baseline any agent needs, that one is Claude's own operating instructions on top of it.

Keepsake (product name "Pantry" internally in some docs — same app) is a calm, opinionated recipe app: Expo/React Native + TypeScript client, Supabase (Postgres + RLS + Storage + Edge Functions) backend, Anthropic Claude API called server-side only.

## Repo map

- `app/` — Expo Router screens (client).
- `src/` — client logic: `session/` (auth), `household/` (household/profile state), `recipes/` (CRUD, screens), `sync/` (offline SQLite mirror + pull/push), `import/` (Share Extension outbox, batch import), `db/` (local SQLite schema/migrations).
- `server/` — runtime-neutral pure TypeScript, executes under both Node (for Jest) and Deno (the Edge Function): `server/units/` (quantity parsing/scaling), `server/import/` (URL fetch, HTML reduction, JSON-LD extraction), `server/ai/` (Claude extraction calls). No side effects at import time; keep it that way.
- `supabase/functions/import-recipe/` — the one Deno Edge Function. Pinned import map in `deno.json`. Uses the caller's own JWT (never service-role) so RLS applies inside it same as anywhere else.
- `supabase/migrations/` — forward-only SQL migrations. `supabase/tests/database/` — pgTAP tests, one file per migration/RPC group, run for real against Postgres in CI.
- `docs/` — `prd.md` (product spec), `architecture.md` (living system-architecture overview — read this right after this file), `roadmap.md` (milestones and work-item backlog — what's still left to build), `execution-plan.md` (phase-by-phase build plan, security checklists per phase), `current.md` (current-state pointer — see below), `history/` (one archive file per phase, load a specific one only when needed), `threat-model.md` (T-numbered entries), `prd-traceability.md` (requirement ID → phase → status), `adr/` (numbered decision records).
- `.claude/skills/` — `start-phase`, `exit-phase`, `pr-ready`, `security-check` encode this project's recurring workflows.

## Durable security invariants

These don't change phase to phase — treat a PR that violates one as a blocking finding regardless of what else it does well:

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

Run the full sequence locally before every push, not a hand-picked subset — CI runs `typecheck`, `lint`, `format:check`, and `test` as four separate steps in that order, and any one of them failing burns a full CI run. Running only the test files you touched, or only `tsc`, is not a substitute for actually running `npm run lint` and `npm run format:check` too (found the hard way: a PR passed targeted tests and typecheck locally but failed CI on `format:check` alone).

## Current-state pointer

Read [`docs/current.md`](docs/current.md) — short by design (Current phase/status/next-action, a trimmed history index, carried-forward items) — for the active phase, its status, and next action. Full phase-by-phase narrative lives in `docs/history/phase-NN-*.md`, one file per phase; load a specific one only when a task needs that phase's detail. If you need design rationale rather than a phase narrative, `docs/adr/` is indexed by number and faster to search.

## Git / PR flow

Feature branches off `main`, named `phase-N-<short-name>` for phase work or `<area>/<short-name>` for cross-cutting fixes. This environment (and most agent sessions here) has no push credentials — expect to see a branch and an open PR, not direct commits to `main`. PR descriptions follow `.github/PULL_REQUEST_TEMPLATE.md`.

## Approval boundaries

An agent working here should proceed without asking for: implementation details, library internals, test structure, refactors within the stated scope. It should stop and ask a human before: a product/design decision the PRD doesn't already answer; a phase exit-gate sign-off (Pass/Conditional Pass/Fail); anything touching credentials, secrets, or production/staging access; a destructive or hard-to-reverse action outside the current scoped work (schema drops, force-pushes, history rewrites, deleting data).

## Definition of done

A change is done when: the canonical commands above pass, the phase's (or PR's) own security checklist has been considered — not skipped — per `.claude/skills/security-check`, and `docs/prd-traceability.md` is updated for any PRD requirement ID the change provides evidence for. A migration or RPC change additionally needs its pgTAP suite actually run, not just written.

## Review priorities for Codex

Codex reviews every PR on this repo. In priority order:

1. **Security.** Household/RLS boundary correctness on any new table, column, or RPC — does a query or function actually get scoped by the caller's household, or does it only look like it does? Server-only code crossing into client bundles — a new import in `src/` or `app/` reaching into `server/ai`, `server/import`'s network/secret-touching modules, or anything that would put a credential in the Metro bundle. Any new external-input surface (URL, upload, deep link, AI output) used before validation.
2. **Maintainability.** Prefer this repo's established patterns over a new one for the same problem — pure runtime-neutral modules in `server/`, one RPC per write boundary, an ADR recorded before a non-obvious cross-cutting decision, not after. Flag complexity that isn't earning its keep, and duplicated logic that should be one shared call site instead. This includes comment and doc weight: a comment or `docs/history/` entry that re-derives an ADR's whole decision inline instead of citing it, or that's grown longer than the code/decision it explains, is a maintainability finding — flag it the same as any other unearned complexity.
3. **Race conditions.** Atomicity of multi-step `security definer` functions and multi-RPC request handlers — a partial failure between two separate database calls that should have been one transaction is a recurring defect class in this repo; `docs/adr/0020-import-fencing-and-local-data-isolation.md` (`finalize_import_job`) is the canonical fix pattern to compare against: merge the steps into one function, call the existing save/create RPC directly rather than duplicating its body (nested `security definer` calls share the outer transaction), and fence any claim/lease with a token, not just a timestamp. Also watch for concurrency assumptions stated as comments but not enforced in SQL — "idempotent" or "single-winner" claims that aren't backed by a unique constraint, row lock, or atomic `UPDATE ... WHERE ... RETURNING`.
4. **Product requirements.** Does the change actually satisfy the PRD requirement ID(s) it claims (`docs/prd-traceability.md`), and does it match the phase's stated build scope in `docs/execution-plan.md` — not scope-creeping into a later phase's territory or silently dropping part of the current one?

Report findings against real code paths, not the PR diff in isolation — this repo's bugs have mostly been in what a diff *doesn't* touch (a second call site, an existing test that should have caught it, a downstream table).
