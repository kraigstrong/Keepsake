-- Phase 16 follow-up (Codex review, PR #49): two gaps in the archive/
-- delete lifecycle that shipped in the previous two migrations. Both
-- existing migrations are already assumed applied elsewhere by the time
-- this runs, so these are corrective ALTERs/CREATE OR REPLACEs rather
-- than edits to those files.

-- 1. permanently_delete_recipe's hard DELETE would raise a foreign-key
-- violation for any recipe ever created by an import, or later chosen
-- as an import's resolved duplicate — import_jobs.recipe_id and
-- duplicate_of_recipe_id (20260805100000_import_jobs_schema.sql) are
-- plain FKs with no ON DELETE clause (default NO ACTION). Since URL
-- import is this app's primary recipe-creation path, that would have
-- made LIFE-07 fail for the overwhelming majority of real recipes, not
-- an edge case. SET NULL: once a recipe is permanently gone, the
-- import_jobs row itself still has value as provenance/debugging
-- history (its own migration's comment), it just no longer needs a
-- live pointer to a row that no longer exists.
alter table public.import_jobs
  drop constraint import_jobs_recipe_id_fkey,
  add constraint import_jobs_recipe_id_fkey
    foreign key (recipe_id) references public.recipes(id) on delete set null;

alter table public.import_jobs
  drop constraint import_jobs_duplicate_of_recipe_id_fkey,
  add constraint import_jobs_duplicate_of_recipe_id_fkey
    foreign key (duplicate_of_recipe_id) references public.recipes(id) on delete set null;

-- 2. add_to_weekly_plan / add_recipes_to_weekly_plan
-- (20260806110200_weekly_plan_rpcs.sql) validate that a recipe_id
-- belongs to the caller's household, but never checked archived_at/
-- deleted_at — those columns didn't exist yet when Phase 12 wrote this
-- check (its own comment flagged exactly this: "when it lands, add and
-- archived_at is null here"). LIFE-01's "Archive hides a recipe from
-- ... Planning" is a server-side enforcement requirement, not just the
-- This-Week add-recipe picker's client-side query (ADR-0025 decision
-- 5) — this app never relies on client-side filtering alone for an
-- authorization-shaped rule, and a client bypassing the picker (or a
-- stale request already in flight) could otherwise still plan an
-- archived or deleted recipe.
create or replace function public.add_to_weekly_plan(plan_id uuid, recipe_id uuid, servings integer)
returns public.planning_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  plan_status text;
  next_position integer;
  result_entry public.planning_entries;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select status into plan_status
  from public.weekly_plans
  where id = plan_id and household_id = caller_household_id
  for update;
  if plan_status is null then
    raise exception 'weekly plan not found' using errcode = 'P0001';
  end if;
  if plan_status <> 'planning' then
    raise exception 'weekly plan is not in planning state' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.recipes
    where id = add_to_weekly_plan.recipe_id
      and household_id = caller_household_id
      and archived_at is null
      and deleted_at is null
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  select coalesce(max(position), -1) + 1 into next_position
  from public.planning_entries
  where weekly_plan_id = plan_id;

  insert into public.planning_entries
    (weekly_plan_id, household_id, recipe_id, servings, position, added_by)
  values
    (plan_id, caller_household_id, add_to_weekly_plan.recipe_id, servings, next_position, auth.uid())
  returning * into result_entry;

  update public.weekly_plans set updated_at = now() where id = plan_id;

  return result_entry;
end;
$$;

create or replace function public.add_recipes_to_weekly_plan(
  plan_id uuid,
  recipe_ids uuid[],
  servings_list integer[]
)
returns setof public.planning_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  plan_status text;
  next_position integer;
  item_count integer;
begin
  item_count := coalesce(array_length(recipe_ids, 1), 0);
  if item_count = 0 then
    raise exception 'recipe_ids must not be empty' using errcode = 'P0001';
  end if;
  if array_length(servings_list, 1) is distinct from item_count then
    raise exception 'recipe_ids and servings_list must be the same length' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(servings_list) as s where s <= 0) then
    raise exception 'servings must be positive' using errcode = 'P0001';
  end if;

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select status into plan_status
  from public.weekly_plans
  where id = plan_id and household_id = caller_household_id
  for update;
  if plan_status is null then
    raise exception 'weekly plan not found' using errcode = 'P0001';
  end if;
  if plan_status <> 'planning' then
    raise exception 'weekly plan is not in planning state' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(recipe_ids) as rid
    where not exists (
      select 1 from public.recipes
      where id = rid
        and household_id = caller_household_id
        and archived_at is null
        and deleted_at is null
    )
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  select coalesce(max(position), -1) into next_position
  from public.planning_entries
  where weekly_plan_id = plan_id;

  update public.weekly_plans set updated_at = now() where id = plan_id;

  return query
    insert into public.planning_entries
      (weekly_plan_id, household_id, recipe_id, servings, position, added_by)
    select plan_id, caller_household_id, u.recipe_id, u.servings, next_position + u.ord::integer, auth.uid()
    from unnest(recipe_ids, servings_list) with ordinality as u(recipe_id, servings, ord)
    returning *;
end;
$$;
