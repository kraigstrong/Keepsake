-- ADR-0026: multiplier as the canonical recipe-scaling unit. Replaces
-- planning_entries.servings (an absolute integer that every downstream
-- reader had to divide by recipes.servings_count — a field that's
-- null by design, ADR-0018, whenever a recipe's yield isn't a servings
-- count at all) with planning_entries.multiplier (a scale factor,
-- always meaningful on its own). See the ADR for full rationale;
-- PR #50's ASSUMED_SERVINGS_WHEN_UNKNOWN/DEFAULT_SERVINGS_WHEN_UNKNOWN
-- stopgap this replaces is removed in the same PR as this migration.

alter table public.planning_entries add column multiplier numeric;

-- Backfill: recover the multiplier implied by each existing row's
-- absolute servings count. Codex review, PR #51: ADR-0026's own stated
-- formula ("else 1.0" when the recipe's servings_count is unknown) is
-- wrong — PR #50's stopgap (merged just before this migration was
-- written) already stored servings = round(4 * multiplier) for exactly
-- that case (RecipeDetailScreen's servingsToAdd), and grocery
-- generation / Cooking Mode's plan-default both divided by that same
-- assumed base (4, ASSUMED_SERVINGS_WHEN_UNKNOWN) to recover the
-- multiplier. Backfilling with 1.0 instead would silently reset any
-- existing non-1x selection on a no-servings-count recipe. Using 4 as
-- the fallback divisor here matches exactly what those two consumers
-- already trusted for these rows before this migration.
update public.planning_entries pe
set multiplier = pe.servings::numeric / coalesce(nullif(r.servings_count, 0), 4)
from public.recipes r
where r.id = pe.recipe_id;

alter table public.planning_entries
  alter column multiplier set not null,
  alter column multiplier set default 1.0,
  add constraint planning_entries_multiplier_positive check (multiplier > 0);

alter table public.planning_entries drop column servings;

-- add_to_weekly_plan / add_recipes_to_weekly_plan (most recently
-- redefined in 20260811130000_recipe_lifecycle_security_fixes.sql)
-- take a multiplier instead of an absolute servings count. Postgres
-- treats (uuid,uuid,integer) and (uuid,uuid,numeric) as distinct
-- overloads, so the old integer-typed functions are dropped explicitly
-- rather than replaced — a bare create-or-replace would leave both
-- signatures live and callable.
drop function if exists public.add_to_weekly_plan(uuid, uuid, integer);
drop function if exists public.add_recipes_to_weekly_plan(uuid, uuid[], integer[]);

create function public.add_to_weekly_plan(plan_id uuid, recipe_id uuid, multiplier numeric)
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
  if multiplier <= 0 then
    raise exception 'multiplier must be positive' using errcode = 'P0001';
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
    (weekly_plan_id, household_id, recipe_id, multiplier, position, added_by)
  values
    (plan_id, caller_household_id, add_to_weekly_plan.recipe_id, add_to_weekly_plan.multiplier, next_position, auth.uid())
  returning * into result_entry;

  update public.weekly_plans set updated_at = now() where id = plan_id;

  return result_entry;
end;
$$;

revoke all on function public.add_to_weekly_plan(uuid, uuid, numeric) from public;
grant execute on function public.add_to_weekly_plan(uuid, uuid, numeric) to authenticated;

create function public.add_recipes_to_weekly_plan(
  plan_id uuid,
  recipe_ids uuid[],
  multiplier_list numeric[]
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
  if array_length(multiplier_list, 1) is distinct from item_count then
    raise exception 'recipe_ids and multiplier_list must be the same length' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(multiplier_list) as m where m <= 0) then
    raise exception 'multiplier must be positive' using errcode = 'P0001';
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
      (weekly_plan_id, household_id, recipe_id, multiplier, position, added_by)
    select plan_id, caller_household_id, u.recipe_id, u.multiplier, next_position + u.ord::integer, auth.uid()
    from unnest(recipe_ids, multiplier_list) with ordinality as u(recipe_id, multiplier, ord)
    returning *;
end;
$$;

revoke all on function public.add_recipes_to_weekly_plan(uuid, uuid[], numeric[]) from public;
grant execute on function public.add_recipes_to_weekly_plan(uuid, uuid[], numeric[]) to authenticated;
