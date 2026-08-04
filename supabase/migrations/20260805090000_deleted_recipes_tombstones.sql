-- Phase 6 offline sync (ADR-0013): a narrow, recipe-specific tombstone so
-- an offline client can detect hard deletes, which produce no row to
-- query. No delete feature exists yet (Phase 16) — this is forward
-- plumbing so sync doesn't need to change when that phase lands, since
-- whatever eventually deletes a recipes row (Phase 16's delete/archive
-- flow, or anything else) will fire this trigger regardless of cause.

create table if not exists public.deleted_recipes (
  id uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  deleted_at timestamptz not null default now()
);

create index if not exists idx_deleted_recipes_household_id
  on public.deleted_recipes (household_id, deleted_at, id);

create or replace function public.record_deleted_recipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deleted_recipes (id, household_id)
  values (old.id, old.household_id);
  return old;
end;
$$;

create trigger recipes_record_deletion
  before delete on public.recipes
  for each row
  execute function public.record_deleted_recipe();

alter table public.deleted_recipes enable row level security;

-- Read-only to household members; no insert/update/delete grant for
-- authenticated — only the security-definer trigger above writes here.
create policy "Members can select their household's deleted recipes"
  on public.deleted_recipes
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.deleted_recipes to authenticated;
