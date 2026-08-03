# ADR-0013: Offline read model and sync design

- **Status:** Accepted
- **Date:** 2026-08-03
- **Phase:** 6

## Context

Phase 6's build scope (execution-plan.md) names "SQLite schema and migrations," "initial and incremental sync," "tombstones," "sync cursor," "cached images," and "storage limits" but — like Phase 4/5 before it — specifies no mechanism. Several decisions are needed before any schema or client code can be written, none of which the PRD or an existing ADR answers:

1. Does the local SQLite schema mirror the server's normalized child-table structure (`recipe_ingredient_sections`, `recipe_ingredients`, etc.), or something simpler?
2. How does incremental sync detect "what changed since last time," and how are hard deletes (which produce no row to query) detected at all — especially since no delete feature exists yet (that's Phase 16), so Phase 6 is building tombstone plumbing ahead of its first real user.
3. How is offline connectivity detected?
4. How are cached hero images stored, and what caps their growth?
5. What exactly gets wiped on sign-out?

Phase 6 is scoped to **read-only** offline support (OFF-01 browsing, OFF-02 searching alongside Phase 7). OFF-04 already establishes that editing requires connectivity, and cooking-completion queuing (the one local *write* case) is explicitly Phase 15's job (OFF-05). This phase never needs to reconcile a local write against a server write — that simplifies everything below.

## Decision

**Local schema mirrors the client's already-flattened read shape, not the server's normalized tables.** `src/recipes/api.ts`'s `Recipe` type already returns ingredient/instruction sections as nested arrays from one query — nothing client-side ever queries into child rows independently, and `save_recipe` already wipes-and-reinserts all child rows on every edit (ADR-0010), so there is no finer-grained change to track than "this recipe changed." The local SQLite `recipes` table stores one row per recipe: scalar columns plus `ingredient_sections`/`instruction_sections`/`tags`/`category_ids` as JSON columns. No local child tables, no local joins.

**Sync cursor is `(updated_at, id)`, not `updated_at` alone.** A plain timestamp cursor can miss or double-fetch rows updated in the same instant. Incremental sync queries `where household_id = :h and (updated_at, id) > (:cursor_updated_at, :cursor_id) order by updated_at, id`. A recipe whose `updated_at` moved gets a full nested-embed re-read (the same query Recipe Detail already uses) and a full local upsert — never a partial patch.

**Tombstones are a narrow, recipe-specific table added now, ahead of Phase 16's delete feature.** A generic multi-table tombstone system would be speculative — recipes is the only offline-cached entity that exists today. `deleted_recipes(id, household_id, deleted_at)`, populated by a `before delete` trigger on `recipes`, RLS-readable by household members, no client insert/update/delete. Sync pulls `deleted_recipes` rows newer than its own `(deleted_at, id)` cursor and removes matching local rows. When Phase 16 ships a real delete/archive flow, it writes to `recipes` (or a future `archived_at` column) exactly as today — this trigger doesn't care why a row disappeared.

**Reads stay plain RLS-scoped `select`s, not RPCs** — consistent with ADR-0008 (RPCs are for household/invitation *writes*; recipe reads have always been direct nested-embed selects). Sync is a read path, so it follows the existing convention rather than introducing a new one.

**Categories are small, global, and rarely change** — full refetch-and-replace on every sync cycle, no cursor. Not worth cursor/tombstone machinery for a lookup table with ~11 seeded rows.

**Connectivity detection via `@react-native-community/netinfo`** — Expo's own docs recommend it for exactly this, it's the de facto standard alongside Expo/RN, and it's a new native dependency needing the same `pod install` + rebuild step already flagged for prior phases' additions (`expo-image-manipulator`, `react-native-svg`).

**Cached hero images via `expo-file-system`**, downloaded into the app's local cache directory after a successful nested-embed read, keyed by `hero_image_path`. A `cached_images(path, local_uri, byte_size, last_accessed_at)` local table tracks them. **Storage cap: a fixed total byte budget (100 MB to start — a round, generous number for a household's realistic photo count; not PRD-mandated, revisit if real usage says otherwise), LRU eviction by `last_accessed_at`** when a new image would exceed it. Recipe rows and their JSON payload are not counted against this budget — they're tiny compared to images and existing in full is the point of "offline browsing."

**Sign-out wipes the entire local SQLite database file**, not a per-household row delete. Since a user belongs to exactly one household for MVP (ADR-0004), there's never a second household's cache to preserve, and a full-file wipe is simpler and more clearly correct than a filtered delete for the "no auth credential in SQLite, cache isolated by household" security requirement.

## Alternatives considered

- **Mirror server's normalized child tables locally:** rejected — adds real complexity (7 local tables instead of 1, local joins, per-child-table sync bookkeeping) for data nothing ever queries independently. Revisit only if a future phase needs to query into ingredients/instructions directly (e.g., ingredient-level search) rather than just displaying a whole recipe.
- **Generic multi-table tombstone (`table_name` column, works for any future entity):** rejected as premature abstraction — recipes is the only case today; a second case can copy this three-line pattern when it exists.
- **`updated_at`-only cursor:** rejected — same-timestamp collisions are a real (if rare) correctness bug, and `(updated_at, id)` costs nothing extra to implement now.
- **Sync as an RPC instead of plain selects:** rejected — would introduce a second read pattern alongside the existing nested-embed select for no benefit; RLS already does the enforcement work an RPC would otherwise exist to wrap.
- **`expo-network` instead of `@react-native-community/netinfo`:** considered — `expo-network` covers one-shot state but historically has weaker continuous change-event support than `netinfo`, and offline UI needs the live transition (online → offline mid-session), not just a snapshot at launch.
- **No storage cap / cap by image count instead of bytes:** rejected — a photo-heavy household could otherwise grow the cache unboundedly; a byte budget is the more direct match for "storage limits" in the phase's own build scope.

## Consequences

- Adds two new dependencies: `@react-native-community/netinfo` and `expo-file-system`, both needing `pod install` + a fresh device/Simulator build before they link correctly (same category of follow-up already tracked for prior native additions).
- New migration: `deleted_recipes` table + `before delete` trigger + RLS policy on `public.recipes`. No existing behavior changes — nothing deletes recipes yet.
- Local SQLite schema is intentionally denormalized relative to the server — a future phase adding structured ingredient data (Phase 11, per ADR-0010) will need to revisit whether the local cache still stores ingredients as opaque JSON or needs its own structured columns. Not a blocker now, just a known seam.
- Phase 7 (search) can build its local FTS index directly against this same flattened `recipes` table (title/tags/category text are already columns), no schema change anticipated there.
- Phase 15's cooking-completion outbox (the first local *write* this app will have) is out of scope here and will need its own conflict/queue design when that phase starts — this ADR's read-only cursor model doesn't answer that question.
