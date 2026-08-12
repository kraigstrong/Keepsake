-- Phase 16 archive/delete lifecycle (prd.md §20-21, ADR-0025). Two
-- independent nullable timestamps rather than a status enum — decision 1
-- explains why (an archived recipe that's later deleted, then restored,
-- lands back in Archived Recipes for free with two columns; an enum
-- would need an explicit "previous state" field to recover the same
-- behavior). deleted_at takes precedence over archived_at in every
-- visibility rule this phase adds (see the RLS/RPC migrations that
-- follow) — this migration only adds the columns and indexes.
alter table public.recipes add column archived_at timestamptz;
alter table public.recipes add column deleted_at timestamptz;

-- Serves every exclusion filter this phase adds (Library, Search,
-- planning picker all check "not archived and not deleted"; Archived
-- Recipes checks "archived and not deleted"; Recently Deleted checks
-- "deleted") without a bespoke index per screen.
create index if not exists idx_recipes_household_lifecycle
  on public.recipes (household_id, deleted_at, archived_at);

-- ADR-0025 decision 9's amendment: a deleted recipe's source_url must
-- not block re-importing the same URL as a fresh, independent recipe.
-- Dropped and recreated (Postgres has no ALTER INDEX for a partial
-- index's predicate) rather than a second index, since the two would
-- otherwise both try to enforce uniqueness over the same live rows.
-- archived_at is deliberately NOT part of this condition — archiving
-- isn't a "gone" state for import-duplicate purposes the way deletion
-- is; re-importing an archived recipe's URL should still resolve to the
-- existing (archived) recipe, unchanged from today's behavior.
drop index public.recipes_household_source_url_idx;
create unique index recipes_household_source_url_idx
  on public.recipes (household_id, source_url)
  where source_url is not null and deleted_at is null;
