# Architecture

This document describes how Keepsake (product name "Pantry" internally in some docs — same app) fits together *as it currently stands*: the system's shape, its trust boundaries, its data model, and how work happens in this repo. It is a living document, updated as the system changes, not a decision history — it doesn't re-narrate *why* a choice was made or what broke and got fixed along the way. For that, see the ADRs in `docs/adr/` and the phase history in `docs/history/`.

Read this right after [`AGENTS.md`](../AGENTS.md). Any agent — including a freshly-spawned subagent with no memory of a prior conversation — should be able to orient here before touching code. For product requirements, see [`docs/prd.md`](prd.md); for the full security analysis, see [`docs/threat-model.md`](threat-model.md); for how a specific decision was reached, see the relevant ADR.

## System overview

Keepsake is a calm, opinionated recipe app: an Expo/React Native + TypeScript client, a Supabase backend (Postgres + Row-Level Security + Storage + Edge Functions), and the Anthropic Claude API called server-side only, never from the client.

Repo layout:

- `app/` — Expo Router screens (client).
- `src/` — client logic: `session/` (auth), `household/` (household/profile state), `recipes/` (CRUD, screens), `sync/` (offline SQLite mirror + pull/push), `import/` (Share Extension outbox, batch import), `db/` (local SQLite schema/migrations).
- `server/` — runtime-neutral pure TypeScript, executing under both Node (Jest) and Deno (the Edge Function): `server/units/` (quantity parsing/scaling), `server/import/` (URL fetch, HTML reduction, JSON-LD extraction), `server/ai/` (Claude extraction calls). No side effects at import time — kept that way deliberately, since the same code runs in two different runtimes.
- `supabase/functions/import-recipe/` — the one Deno Edge Function. Uses the caller's own JWT, never the service-role key, so RLS applies inside it the same as everywhere else.
- `supabase/migrations/` — forward-only SQL migrations. `supabase/tests/database/` — pgTAP tests, one file per migration/RPC group, run for real against Postgres in CI.
- `docs/` — `prd.md` (product spec), `execution-plan.md` (phase-by-phase build plan and validation framework), `current.md` (current-state pointer), `history/` (one archive file per phase), `threat-model.md` (trust boundaries and T-numbered threat catalog), `prd-traceability.md` (requirement ID → phase → status), `adr/` (numbered decision records), this file.

## Trust boundaries

The client only ever holds Supabase's publishable key; every access-control decision that actually matters — household isolation above all — is enforced by RLS and Storage policy at the Supabase boundary, never by client-side filtering. Only the Anthropic API key is a genuine server-only secret inside the Edge Function — it calls Supabase using the caller's own JWT, never the service-role key, so RLS applies there too, the same as everywhere else. Nothing in this app's runtime path reads the service-role key at all. See [`docs/threat-model.md`](threat-model.md) §2 for the full trust-boundary diagram and the T-numbered threat catalog; this document doesn't reproduce either.

## Data model

The core recipe schema (`docs/adr/0010-recipe-data-model.md`) shapes as follows today:

- **Recipes** live in a `recipes` table (title, hero image, active/total time, yield, source URL/attribution, tags, plus planning/cooking-derived columns added by later phases such as `planned_count`).
- **Ingredients and instructions are two separate concepts**, each its own section/line table pair: `recipe_ingredient_sections` → `recipe_ingredients`, and `recipe_instruction_sections` → `recipe_instructions`. A recipe with no explicit sections still gets one default (untitled) section per list, so callers never special-case "no sections."
- **Ingredient and instruction lines are plain text**, not structured quantity/unit/name fields — quantities live inline in the text (e.g. "2 lb baby potatoes, halved"). `server/units/` (ADR-0018) parses quantity/unit information out of that text at read time rather than the schema storing it structured; a parse it can't confidently make returns the original text verbatim rather than guessing.
- **Categories are structured, tags are free-form.** Categories come from a seeded, extensible lookup table (`categories`: `group_name` constrained to `protein`/`dish_type`/`preparation`, `value` text) joined via `recipe_categories` — a fixed, group-scoped vocabulary that Library's filter UI keys off directly. Tags are a plain `text[]` column on `recipes` — no identity or metadata of their own.
- **No draft/version/conflict state on the recipe row itself.** The recipe save RPC (`save_recipe`) is a single atomic write that wipes and reinserts all child rows on every edit; see `docs/adr/0011-drafts-versions-conflicts.md` for how draft/conflict handling is layered on top without a `recipe_versions` table.
- **Images** reuse the household-scoped `recipe-images` Storage bucket and `<household_id>/...` path convention established for household/auth in `docs/adr/0008-household-auth-and-server-operations.md`.
- Every recipe write RPC follows the same `SECURITY DEFINER` + re-derive-household-from-caller pattern established in ADR-0008 — no separate authorization mechanism per feature.

Later phases (import, weekly planning, grocery export, cooking mode) add their own tables following this same shape: RLS via the household-membership helper, one RPC per write boundary, household id denormalized onto child tables. See the relevant numbered ADR (`docs/adr/00NN-*.md`) for a given feature's specific schema.

## Offline & sync architecture

Recipes are the one entity mirrored locally for offline browsing and search (`docs/adr/0013-offline-read-model-and-sync.md`); nothing else in the app has an offline read path.

- **Local shape is denormalized, not a mirror of the server's child tables.** The local SQLite `recipes` table stores one row per recipe — scalar columns plus `ingredient_sections`/`instruction_sections`/`tags`/`category_ids` as JSON columns — matching the client's already-flattened read shape (`src/recipes/api.ts` returns nested sections from one query). There are no local child tables and no local joins.
- **Sync is pull-only and cursor-based**, keyed on `(updated_at, id)` rather than a plain timestamp, to avoid missing or double-fetching rows updated in the same instant. A changed recipe is re-read in full (the same nested-embed query used elsewhere) and fully upserted locally — never patched.
- **Deletes propagate via a narrow tombstone table**, `deleted_recipes(id, household_id, deleted_at)`, populated by a `before delete` trigger on `recipes`. Sync pulls tombstones newer than its own cursor and removes the matching local rows.
- **Categories** are small and rarely change, so they're refetched and replaced in full on every sync cycle — no cursor or tombstone machinery.
- **Reads are plain RLS-scoped `select`s**, consistent with recipe reads elsewhere in the app — sync is a read path, so it doesn't introduce an RPC for something RLS already secures.
- **Hero images are cached separately** via `expo-file-system`, downloaded into the app's cache directory after a successful read, with a fixed 100 MB total byte budget and LRU eviction. Recipe row data isn't counted against this budget.
- **Sign-out clears the recipe mirror by table name, not by deleting the whole database file.** `import_outbox` (Phase 9), `grocery_exports`, and `cooking_event_outbox` (Phase 15) are deliberately excluded from the wipe — each holds locally-captured state (an unsent Share Extension submission, export bookkeeping, an offline cooking completion) that's the only copy of that data until it syncs, unlike the rebuildable recipe mirror everything else here is. This wipe is a tidiness measure, not the authorization boundary: local reads are household-scoped (`src/sync/offlineRecipes.ts`, `src/search/buildSearchQuery.ts`), so a wipe failure leaves stale, unreadable rows behind rather than exposing them to a different account signing in next.

**Standing principle: not everything is mirrored offline, and that's deliberate.** Recipe browsing and search are the only offline-capable surfaces. Anything that requires a write against shared, actively-changing household state — importing, editing a recipe, weekly planning, grocery export — requires connectivity and is explicitly excluded from the offline mirror (prd-traceability.md's OFF-04). Weekly planning (`docs/adr/0021-weekly-plan-data-model.md`) is a concrete instance of this: it bypasses `src/sync/*` entirely, reading and writing directly against Postgrest and RPCs, and resyncs by refetching on screen focus rather than through the cursor/tombstone machinery recipes use. The one local *write* case in the app — Cooking Mode's offline completion queue (`docs/adr/0024-cooking-mode-and-offline-completion.md`) — is a separate outbox mechanism, not an extension of this read-only sync model.

## Testing strategy

The iOS Simulator is the default and sufficient environment for verifying a change works. A physical-device pass is required only for the specific kinds of behavior Simulator can't faithfully represent:

- **Native capabilities Simulator doesn't fully emulate** — the Share Extension / App Group handoff path, Apple Reminders integration, and any behavior gated on real hardware permissions.
- **Live camera capture** — Simulator has no camera, so photo-import extraction can only be verified end-to-end on a device.
- **Screen-awake / real kitchen-use behavior** — Cooking Mode's keep-awake behavior and general in-kitchen usability need to be felt on a real device, not inferred from Simulator.

Outside of those categories, Simulator evidence is sufficient for a build's exit verification — most of this app's surface (schema, RLS, domain logic, search, planning, grocery generation, general UI) doesn't exercise anything that behaves differently between Simulator and a real device, and requiring a physical-device pass everywhere would mean interrupting the developer far more than the risk justifies. When a change touches one of the categories above, plan for a physical-device pass as part of that work rather than treating Simulator-only verification as sufficient.

Separately, before any body of work is considered ready for real users outside the development team — a release-readiness milestone, not a per-feature check — at least one full pass through the core user journeys happens on a physical device, covering flows that are otherwise Simulator-safe on their own. This is a broader, one-time confirmation that the whole product holds together on real hardware, not a substitute for the per-category passes above.

## How work happens here

For security invariants, secret handling, and when to ask vs. proceed, see [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md) — not restated here, so there's exactly one place to check, not several that can drift apart.

**Vertical slices, not layers.** Prefer a complete, user-visible slice of behavior over finishing one technical layer (schema, then API, then UI) in isolation across an entire feature.

**Incremental commits, not one giant one.** A coherent piece of work is delivered as multiple commits, each accomplishing one understandable, human-reviewable outcome, leaving the branch in a valid state, including tests for behavior changes, and passing type checks. Typical ordering: requirements/acceptance criteria → schema/contract changes → security policies and database tests → domain logic and unit tests → server operations and integration tests → client data access → UI behavior → end-to-end coverage → observability/docs → removal of temporary flags. Security ships with or before the capability it protects, never after.

**Pull requests stay narrow.** Each PR has a specific objective, references the PRD identifiers it addresses, describes security implications, lists tests, identifies migrations, and states limitations — rather than squashing a large body of work into one commit or one PR.
