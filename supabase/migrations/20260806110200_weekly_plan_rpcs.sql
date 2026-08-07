-- Phase 12 (ADR-0021): six narrow RPCs, same SECURITY DEFINER +
-- re-derive-household-from-auth.uid() shape as save_recipe / the import
-- job RPCs — never trust a client-supplied household_id.

-- week_key is computed client-side (no stored household timezone exists
-- to derive it server-side, ADR-0021) and validated here as an opaque
-- partition key. The upsert is atomic, so two concurrent calls for the
-- same not-yet-existing week can't race into a unique-constraint error —
-- the loser just gets the winner's row back via ON CONFLICT ... RETURNING.
-- Parameter is week_key_param, not week_key — an ON CONFLICT target
-- column list only ever names table columns (it can't be qualified the
-- way a WHERE/VALUES reference can), so a same-named parameter makes
-- "week_key" genuinely ambiguous there, not just a style nit. Matches
-- this codebase's existing _param suffix convention for exactly this
-- collision (see e.g. save_recipe's recipe_id_param).
create or replace function public.get_or_create_current_weekly_plan(week_key_param text)
returns public.weekly_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_plan public.weekly_plans;
begin
  if week_key_param !~ '^\d{4}-W\d{2}$' then
    raise exception 'invalid week_key format' using errcode = 'P0001';
  end if;

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  insert into public.weekly_plans (household_id, week_key)
  values (caller_household_id, week_key_param)
  on conflict (household_id, week_key) do update
    set updated_at = public.weekly_plans.updated_at
  returning * into result_plan;

  return result_plan;
end;
$$;

revoke all on function public.get_or_create_current_weekly_plan(text) from public;
grant execute on function public.get_or_create_current_weekly_plan(text) to authenticated;

-- Appends to the end of the plan (position = current max + 1). Rejects a
-- plan that isn't in 'planning' state (the UI's "Edit Plan" link is the
-- only way back into planning from confirmed — see reopen_weekly_plan
-- below) and a recipe_id that doesn't resolve inside the caller's own
-- household (cross-household recipe IDs / deleted recipes rejected,
-- Phase 12 security bullet). No archived_at column exists yet
-- (LIFE-01 is Phase 16) — when it lands, add `and archived_at is null`
-- here, same forward-compatible reasoning as deleted_recipes_tombstones.sql.
--
-- `for update` on the plan row (Codex review, PR #36): without it, two
-- concurrent adds from different household members can both read the
-- same max(position) before either inserts, landing two entries on the
-- same position — the plan row lock serializes concurrent writers
-- instead, same pattern reorder_planning_entries below now uses.
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
    where id = add_to_weekly_plan.recipe_id and household_id = caller_household_id
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

revoke all on function public.add_to_weekly_plan(uuid, uuid, integer) from public;
grant execute on function public.add_to_weekly_plan(uuid, uuid, integer) to authenticated;

-- Batch counterpart to add_to_weekly_plan, for the multi-select
-- Add-to-This-Week flow (Codex review, PR #36): that screen used to loop
-- add_to_weekly_plan once per selected recipe client-side, so a failure
-- partway through left a partially-applied selection with no way to
-- retry without risking duplicate entries for whichever recipes had
-- already succeeded. This validates and inserts the entire selection in
-- one transaction — all recipes must exist in the caller's household and
-- every serving count must be positive, or nothing is inserted at all.
-- recipe_ids/servings_list are parallel arrays (PostgREST has no native
-- array-of-objects RPC parameter type); unnest(...) with ordinality zips
-- them back into rows in the caller's original order, same idiom
-- reorder_planning_entries already uses for its own ordered_entry_ids.
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
      select 1 from public.recipes where id = rid and household_id = caller_household_id
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

revoke all on function public.add_recipes_to_weekly_plan(uuid, uuid[], integer[]) from public;
grant execute on function public.add_recipes_to_weekly_plan(uuid, uuid[], integer[]) to authenticated;

-- Reorder validates ownership (Phase 12 security bullet): ordered_entry_ids
-- must be exactly the set of entries already in this plan — no missing,
-- no extra, no duplicate, no id belonging to a different plan/household.
-- Restricted to 'planning' state, matching the design (confirmed rows show
-- a chevron that navigates to the recipe, not a drag handle).
create or replace function public.reorder_planning_entries(plan_id uuid, ordered_entry_ids uuid[])
returns setof public.planning_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  plan_status text;
  entry_count integer;
  provided_count integer;
  distinct_count integer;
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

  select count(*) into entry_count
  from public.planning_entries
  where weekly_plan_id = plan_id;

  provided_count := coalesce(array_length(ordered_entry_ids, 1), 0);
  select count(distinct e) into distinct_count from unnest(ordered_entry_ids) as e;

  if provided_count <> entry_count or distinct_count <> entry_count then
    raise exception 'ordered_entry_ids must match this plan''s entries exactly' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(ordered_entry_ids) as e
    where not exists (
      select 1 from public.planning_entries
      where id = e and weekly_plan_id = plan_id
    )
  ) then
    raise exception 'entry does not belong to this plan' using errcode = 'P0001';
  end if;

  update public.planning_entries pe
  set position = ord.idx - 1
  from unnest(ordered_entry_ids) with ordinality as ord(entry_id, idx)
  where pe.id = ord.entry_id and pe.weekly_plan_id = plan_id;

  update public.weekly_plans set updated_at = now() where id = plan_id;

  return query
    select * from public.planning_entries where weekly_plan_id = plan_id order by position;
end;
$$;

revoke all on function public.reorder_planning_entries(uuid, uuid[]) from public;
grant execute on function public.reorder_planning_entries(uuid, uuid[]) to authenticated;

-- Restricted to 'planning' state, matching the design (no remove
-- affordance shown on confirmed rows). Phase 15's Cooking Mode has its
-- own "optional removal from This Week" from a confirmed plan
-- (COOK-05) — a separate RPC for that phase to add, not a reason to
-- loosen this one now.
create or replace function public.remove_planning_entry(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  deleted_count integer;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  delete from public.planning_entries pe
  using public.weekly_plans wp
  where pe.id = entry_id
    and pe.weekly_plan_id = wp.id
    and pe.household_id = caller_household_id
    and wp.status = 'planning';

  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'planning entry not found or not removable' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.remove_planning_entry(uuid) from public;
grant execute on function public.remove_planning_entry(uuid) to authenticated;

-- WEEK-03: confirming increments planned_count (FREQ-01 reads it
-- directly). Idempotent by construction: counting happens per-entry
-- (planning_entries.counted), not per confirm call, so re-confirming an
-- already-confirmed plan — or the Edit Plan -> add/remove -> re-confirm
-- cycle the UI's "Edit Plan" link enables — only counts entries that
-- haven't been counted yet. Rejects an empty plan (nothing to confirm).
--
-- Also stamps recipes.updated_at (Codex review, PR #36): the offline
-- sync engine's incremental pull is cursored on (updated_at, id)
-- (ADR-0013) — a recipe whose only change is planned_count would never
-- be re-fetched by an already-synced device otherwise, leaving Library's
-- Frequently Selected tier permanently stale on that device until the
-- recipe changed for some unrelated reason.
create or replace function public.confirm_weekly_plan(plan_id uuid)
returns public.weekly_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_plan public.weekly_plans;
  entry_count integer;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select count(*) into entry_count
  from public.planning_entries
  where weekly_plan_id = plan_id and household_id = caller_household_id;

  if entry_count = 0 then
    raise exception 'weekly plan has no recipes to confirm' using errcode = 'P0001';
  end if;

  update public.recipes r
  set planned_count = r.planned_count + 1, updated_at = now()
  from public.planning_entries pe
  where pe.weekly_plan_id = plan_id
    and pe.household_id = caller_household_id
    and pe.counted = false
    and r.id = pe.recipe_id;

  update public.planning_entries
  set counted = true
  where weekly_plan_id = plan_id and household_id = caller_household_id and counted = false;

  update public.weekly_plans
  set status = 'confirmed', confirmed_at = now(), updated_at = now()
  where id = plan_id and household_id = caller_household_id
  returning * into result_plan;

  if result_plan is null then
    raise exception 'weekly plan not found' using errcode = 'P0001';
  end if;

  return result_plan;
end;
$$;

revoke all on function public.confirm_weekly_plan(uuid) from public;
grant execute on function public.confirm_weekly_plan(uuid) to authenticated;

-- The UI's "Edit Plan" link (confirmed -> planning). Deliberately leaves
-- confirmed_at and every entry's counted flag untouched — re-confirming
-- later must not double-count entries this already counted once.
create or replace function public.reopen_weekly_plan(plan_id uuid)
returns public.weekly_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_plan public.weekly_plans;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.weekly_plans
  set status = 'planning', updated_at = now()
  where id = plan_id and household_id = caller_household_id and status = 'confirmed'
  returning * into result_plan;

  if result_plan is null then
    raise exception 'weekly plan not found or not confirmed' using errcode = 'P0001';
  end if;

  return result_plan;
end;
$$;

revoke all on function public.reopen_weekly_plan(uuid) from public;
grant execute on function public.reopen_weekly_plan(uuid) to authenticated;
