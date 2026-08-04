// Local SQLite schema (ADR-0013). One migration per schema_version bump —
// add a new numbered entry here rather than editing an existing one once
// it's shipped, same discipline as the Supabase migrations directory.

export const SCHEMA_VERSION = 2;

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
};
