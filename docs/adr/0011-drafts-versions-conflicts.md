# ADR-0011: Drafts, version history, and conflict handling

- **Status:** Accepted
- **Date:** 2026-08-03
- **Phase:** 5

## Context

Phase 4 deliberately shipped `save_recipe` with no versioning at all (ADR-0010): a single atomic
write, no `recipe_versions` table, no draft persistence, no base-version check. Phase 5 is where
that gets built — prd.md §23 ("Version History") and §26's `RecipeVersion`/`RecipeDraft` entities
name the shape at a product level; execution-plan.md's build scope (user-specific drafts,
base-version number, draft persistence, immutable snapshots, version history, restore, conflict
handling) names the mechanics, but neither specifies exact schema or UX. Two genuine design
questions needed resolving before writing any migration:

1. **Are drafts server-synced (per-user, cross-device) or purely device-local?** prd.md never
   says "device-specific" for drafts the way it explicitly does for cooking-checklist progress
   (§17: "Cooking checklist progress is device-specific. Cooking history and notes are shared.").
   Execution-plan.md calls drafts "user-specific," not "device-specific" — a different word,
   used deliberately elsewhere in the same document. That's a real signal, not just phrasing.
2. **What does "conflict handling" actually look like for the user?** Neither doc mentions a
   diff, merge, or side-by-side comparison anywhere. Execution-plan.md's phrase is "conflict
   prevention" (§ Preserve and recover data), not "conflict resolution" or "conflict merging."
   Combined with prd.md §2.1's "if a feature creates more decisions than value, remove it" and
   the household size this is built for (one or two people, prd.md §3), building real merge
   tooling reads like solving a problem this product doesn't actually have yet.

## Decision

**Drafts are server-synced, scoped to the owning user, not the household.** A `recipe_drafts`
table (`id`, `recipe_id` nullable — null means a draft for a not-yet-created recipe —, `user_id`,
`household_id` denormalized for RLS, `draft_payload jsonb`, `updated_at`), with RLS restricted to
`auth.uid() = user_id`. Unlike every other recipe table, this is genuinely single-owner data with
a trivial ownership check (no household-membership derivation needed), so it's the one place a
direct RLS-enforced client write is appropriate instead of routing through a SECURITY DEFINER RPC
— Supabase's own idiom for owner-scoped rows, and simpler than adding another RPC for no
authorization benefit.

**Version history is one JSONB snapshot per explicit save, not a fully normalized versioned
schema.** `recipes` gets a `version integer not null default 1` column. `recipe_versions`
(`id`, `recipe_id`, `household_id`, `version_number`, `snapshot jsonb`, `created_by`,
`created_at`) stores the entire recipe payload — the same shape `save_recipe` already accepts —
as one immutable row per save. RLS: household members can `select`, no client write grants
(RPC-only, same pattern as every write in this schema since ADR-0008). Nothing in the PRD asks
to query or search *inside* old versions — only list them and restore one — so a normalized
`recipe_version_ingredients`/`recipe_version_instructions`/etc. shadow schema would be pure
overhead for a capability nothing needs.

**`save_recipe` gains an optional `baseVersion` field, checked before any write on edit.** The
caller sends the version it loaded; if `recipes.version` has since changed, the RPC raises a
conflict error and writes nothing — matching the atomicity guarantee ADR-0010 already proved
(an invalid write touches nothing, not just "most of nothing"). On success (create or edit),
`recipes.version` increments (starts at 1 on create) and a `recipe_versions` snapshot is
inserted, in the same transaction. A matching `recipe_drafts` row for that recipe is deleted on
successful save — the draft has become the real thing.

**Conflict resolution is block-and-reload, not merge.** A save rejected for a stale
`baseVersion` fails outright with a clear "this recipe was changed by someone else" state; the
editor offers a reload-to-latest action, and the user's own unsaved edits stay in their local
draft (not lost, not silently overwritten) until they choose to redo them against the fresh
version. No diff view, no field-level merge. This satisfies "concurrent edits cannot silently
overwrite" (execution-plan.md) without inventing a comparison UI the source docs never describe.

**Restoring a version is not subject to the conflict check.** `restore_recipe_version(version_id)`
re-applies a snapshot's payload through `save_recipe`'s own atomic path, producing a new version
number rather than reusing the old one (VER-04: "restoring creates a new version, later history
is preserved"). Restoring is an explicit, deliberate action the user chose — not the accidental
overwrite the `baseVersion` check exists to prevent — so gating it behind the same check would
just be friction with no safety benefit.

## Alternatives considered

- **Device-local drafts (AsyncStorage, no server table):** rejected — simpler, but loses a draft
  on reinstall or a new device, which is a worse experience than the schema cost of one small
  owner-scoped table, and the PRD's own word choice ("user-specific," not "device-specific")
  points away from it.
- **Fully normalized version snapshots** (a parallel versioned schema mirroring the live tables):
  rejected — no requirement to query inside history, only list and restore; a JSONB snapshot
  does both without a second copy of the whole schema shape to maintain.
- **Show-what-changed / diff-based conflict resolution:** rejected for MVP — real engineering
  cost (computing and rendering a meaningful diff across sections, ingredients, instructions,
  categories, and tags) for a scenario the product's own household size makes rare, and nothing
  in the source docs asks for it. Revisit if real usage shows block-and-reload is actually
  painful, not preemptively.
- **Last-write-wins with a post-hoc notification, no block:** rejected — technically nothing is
  destroyed (it's still in history), but the save succeeds without the saving editor ever being
  aware of the conflict, which reads as exactly the "silent" overwrite the exit gate rules out.

## Consequences

- The editor needs a genuinely new state it didn't have in Phase 4: "save rejected, reload
  available" — not just the existing load-error/save-error states.
- Autosave-to-draft must never touch `recipes.version` or insert a `recipe_versions` row (VER-02)
  — it's a distinct write path from `save_recipe`, not a lightweight version of it.
- `recipe_drafts` is the first table in this schema where RLS enforces per-user rather than
  per-household ownership — worth remembering as precedent if a similar single-owner need comes
  up later (e.g. per-user settings).
- Phase 6's offline/SQLite work should treat drafts the same way it treats everything else it
  caches locally — nothing about this design assumes Phase 6 doesn't exist yet, but the two
  haven't been reconciled in detail.
