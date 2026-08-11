// Local SQLite schema (ADR-0013). One migration per schema_version bump —
// add a new numbered entry here rather than editing an existing one once
// it's shipped, same discipline as the Supabase migrations directory.

export const SCHEMA_VERSION = 11;

export const MIGRATIONS: Record<number, readonly string[]> = {
  1: [
    // Mirrors the client's already-flattened Recipe read shape (see
    // src/recipes/api.ts), not the server's normalized child tables —
    // nothing local ever queries into ingredients/instructions
    // independently, so there's nothing to gain from splitting them out.
    `create table if not exists recipes (
      id text primary key,
      household_id text not null,
      version integer not null,
      title text not null,
      hero_image_path text,
      active_time_minutes integer,
      total_time_minutes integer,
      yield_text text,
      permanent_notes text,
      source_url text,
      source_attribution text,
      tags text not null,
      category_ids text not null,
      ingredient_sections text not null,
      instruction_sections text not null,
      updated_at text not null,
      synced_at text not null
    )`,
    `create index if not exists idx_recipes_household_id on recipes (household_id)`,
    // Small global taxonomy, full-refetch-replaced on every sync — no
    // cursor needed (ADR-0013).
    `create table if not exists categories (
      id text primary key,
      group_name text not null,
      value text not null
    )`,
    // One row per household (always exactly one for MVP, ADR-0004).
    // Cursor is (updated_at, id) not a bare timestamp — see ADR-0013.
    `create table if not exists sync_state (
      household_id text primary key,
      recipes_cursor_updated_at text,
      recipes_cursor_id text,
      deletes_cursor_deleted_at text,
      deletes_cursor_id text,
      last_synced_at text
    )`,
    // Hero images downloaded for offline display. path is the Storage
    // object path (stable, unlike a signed URL which expires).
    `create table if not exists cached_images (
      path text primary key,
      local_uri text not null,
      byte_size integer not null,
      last_accessed_at text not null
    )`,
  ],
  // Search (Phase 7, ADR-0014). Standalone FTS5 tables — NOT external-
  // content against `recipes` (content=/content_rowid=): recipes.id is a
  // text UUID, and while SQLite gives every rowid table an implicit
  // integer rowid regardless of its declared primary key type, that
  // implicit rowid isn't guaranteed stable across a VACUUM unless it's an
  // `integer primary key` alias — a real footgun for a table already
  // keyed by a stable id. recipe_id is stored as a plain `unindexed`
  // column instead and maintained explicitly by src/sync/local.ts
  // (delete-then-reinsert on every recipe upsert/delete), not by SQL
  // triggers. Column order matters — buildSearchQuery.ts's per-column
  // match queries are positional against this exact order.
  2: [
    `create virtual table if not exists recipe_fts using fts5(
      recipe_id unindexed,
      title,
      ingredients,
      notes,
      source_attribution,
      source_url,
      categories,
      tags,
      tokenize = 'porter unicode61'
    )`,
    // Separate trigram index for the typo-tolerant fallback path only —
    // title alone, since that's the highest-value tier to still surface
    // on a typo (see docs/risk-spikes/sqlite-fts.md).
    `create virtual table if not exists recipe_trigram using fts5(
      recipe_id unindexed,
      title,
      tokenize = 'trigram'
    )`,
  ],
  // Smart sort's "Recently Added (<2wk)" tier (Phase 7, LIB-01/LIB-02)
  // needs when a recipe was *created*, distinct from updated_at (an edit
  // shouldn't make a recipe look newly-added). Schema v1 shipped without
  // it. Existing local rows have no value to backfill from locally — the
  // recipes_cursor reset below forces every already-synced recipe to be
  // refetched on the next syncHousehold() call, which is the only place
  // created_at actually exists (the server row). This is the first real
  // exercise of the "add a column, backfill via resync" migration path
  // (Phase 6 flagged only the v0→v1 case had ever run). deletes_cursor is
  // untouched — nothing about tombstones changed.
  3: [
    `alter table recipes add column created_at text`,
    `update sync_state set recipes_cursor_updated_at = null, recipes_cursor_id = null`,
  ],
  // Durable Share Extension submission (Phase 9, ADR-0016 decisions 1-2,
  // adopting docs/risk-spikes/durable-import-submission.md's design). id
  // is the client-generated UUID minted at capture time in the
  // extension — the same value that becomes the App Group payload's
  // `id` field and, on submission, the server's client_import_id
  // (idempotency end-to-end, one key, never invented later). This table
  // is deliberately excluded from wipeDatabase()'s table list (see
  // database.ts) — an unsent share is the only copy of that share until
  // the server confirms it, so it must survive sign-out rather than
  // being dropped with the rebuildable recipe mirror.
  4: [
    `create table if not exists import_outbox (
      id text primary key,
      url text not null,
      received_at text not null,
      status text not null default 'pending' check (status in ('pending', 'submitting', 'submitted', 'failed')),
      server_job_id text,
      error_message text,
      created_at text not null,
      updated_at text not null
    )`,
  ],
  // Camera/photo import (Phase 10, ADR-0017). No resync-cursor-reset
  // needed here, unlike schema v3's created_at backfill — photo import
  // doesn't exist before this phase ships, so no pre-existing recipe row
  // could have a real value to backfill; every row that ever gets one is
  // freshly created afterward and syncs down complete through the normal
  // incremental pull.
  5: [`alter table recipes add column original_photo_path text`],
  // Units, scaling, and quantity integrity (Phase 11, ADR-0018).
  // ingredient_sections' JSON blob shape changes from string lines to
  // parsed-line objects, but the column itself is untyped opaque text
  // — no ALTER needed there. servings_count mirrors the new server
  // column; like original_photo_path (v5) no resync-cursor reset is
  // needed, since a recipe's server-side servings_count also stays
  // null until it's next edited (ADR-0018 — no bulk backfill), so an
  // already-synced local row being null too is already consistent
  // with the server, not stale.
  6: [`alter table recipes add column servings_count integer`],
  // Import concurrency and local data isolation (Phase 11.5, ADR-0020).
  // household_id is nullable and deliberately NOT backfilled for
  // existing rows — a row already in the outbox was captured before
  // this column existed, so there's no real value to backfill (the
  // outbox has never recorded who captured a share, on purpose, so it
  // survives sign-out); it's treated exactly like a signed-out capture
  // going forward (see outboxEngine.ts), not assumed to belong to
  // whichever household happens to be signed in when this migration
  // runs.
  7: [`alter table import_outbox add column household_id text`],
  // This Week planning (Phase 12, ADR-0021). Mirrors recipes.planned_count
  // for Library's Frequently Selected sort tier (FREQ-01). No resync-
  // cursor reset needed, same reasoning as v6's servings_count: the
  // server column also defaults to 0 for every pre-existing recipe (no
  // plan could have been confirmed before this column existed), so an
  // already-synced local row defaulting to 0 here is already correct,
  // not stale.
  8: [`alter table recipes add column planned_count integer not null default 0`],
  // Apple Reminders export bookkeeping (Phase 14, ADR-0023). Reminders
  // is a local, per-device EventKit store with no server-side
  // representation — this table (not a Supabase one) is the only
  // record of which grocery items have already been exported for a
  // plan, keyed by item_hash (ADR-0022's deterministic merge/selection
  // identity, reused rather than inventing a new one). Deliberately
  // excluded from wipeDatabase()'s table list, same reasoning as
  // import_outbox: an exported reminder is a real, already-happened
  // side effect in a system this app doesn't control, so losing this
  // record on sign-out would mean a re-export after signing back in
  // recreates every item as a duplicate in the real Reminders app.
  9: [
    `create table if not exists grocery_exports (
      weekly_plan_id text not null,
      item_hash text not null,
      household_id text not null,
      reminder_id text not null,
      exported_at text not null,
      primary key (weekly_plan_id, item_hash)
    )`,
    `create index if not exists idx_grocery_exports_household_id on grocery_exports (household_id)`,
  ],
  // Phase 15 cooking mode (ADR-0024). Two tables, matching the PRD's own
  // local/shared split: cooking_sessions is device-specific checklist
  // progress (cleared on sign-out like any other rebuildable UI state,
  // via wipeDatabase()'s RECIPE_MIRROR_TABLES — see database.ts);
  // cooking_event_outbox is the durable local queue for offline
  // completion (OFF-05), copying import_outbox's shape (Phase 9) rather
  // than inventing a new one, and deliberately excluded from the wipe
  // list for the same reason: an unsynced cooking completion is the only
  // copy of that event until the server confirms it.
  10: [
    `create table if not exists cooking_sessions (
      recipe_id text primary key,
      checked_ingredient_keys text not null,
      checked_instruction_keys text not null,
      updated_at text not null
    )`,
    `create table if not exists cooking_event_outbox (
      id text primary key,
      recipe_id text not null,
      household_id text not null,
      cooked_at text not null,
      note text,
      status text not null,
      error_message text,
      created_at text not null
    )`,
    `create index if not exists idx_cooking_event_outbox_status on cooking_event_outbox (status)`,
  ],
  // Archive/delete lifecycle (Phase 16, ADR-0025). Mirrors the server's
  // new recipes.archived_at/deleted_at so Library/Search's existing
  // offline support (OFF-01/02) can exclude them locally too — no
  // resync-cursor reset needed, same reasoning as v6/v8: the server
  // columns also default to null for every pre-existing recipe, so an
  // already-synced local row being null here is already consistent, not
  // stale.
  11: [
    `alter table recipes add column archived_at text`,
    `alter table recipes add column deleted_at text`,
  ],
};
