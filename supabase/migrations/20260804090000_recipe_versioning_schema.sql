-- Phase 5 versioning (prd.md §23, ADR-0011). recipes.version is the
-- optimistic-concurrency counter save_recipe checks against a caller-
-- supplied baseVersion (next migration). recipe_versions is an
-- immutable snapshot per explicit save — one jsonb blob per row, not a
-- parallel normalized schema, since nothing needs to query inside old
-- versions, only list and restore them (ADR-0011).

alter table public.recipes add column if not exists version integer not null default 1;

create table if not exists public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  version_number integer not null,
  -- Mirrors the save_recipe payload shape (see that migration's header
  -- comment) — the entire recipe as of this save.
  snapshot jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (recipe_id, version_number)
);

create index if not exists idx_recipe_versions_recipe_id on public.recipe_versions (recipe_id);

alter table public.recipe_versions enable row level security;

create policy "Members can select their household's recipe versions"
  on public.recipe_versions
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_versions to authenticated;

-- No insert/update/delete grant for authenticated — versions are only
-- ever written by save_recipe/restore_recipe_version (next migrations),
-- both SECURITY DEFINER, matching every other write in this schema.
