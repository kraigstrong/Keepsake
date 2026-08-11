-- Phase 15 (ADR-0024): two narrow RPCs, same SECURITY DEFINER +
-- re-derive-household-from-auth.uid() shape as save_recipe / the
-- weekly-plan RPCs — never trust a client-supplied household_id.

-- Idempotent on client_event_id (ADR-0024 decision 3): the local offline
-- outbox may call this more than once for the same completion (retry
-- after a partial network failure), and a replay must be a safe no-op
-- update, never a duplicate history entry. The `where ... household_id =
-- caller_household_id` guard on the conflict path means a guessed/reused
-- client_event_id from a different household can't overwrite this one's
-- row — returns null (raised below) instead of silently updating it.
create or replace function public.record_cooking_event(
  recipe_id uuid,
  cooked_at timestamptz,
  note text,
  client_event_id uuid
)
returns public.cooking_events
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_event public.cooking_events;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.recipes
    where id = record_cooking_event.recipe_id and household_id = caller_household_id
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  insert into public.cooking_events
    (recipe_id, household_id, cooked_at, note, cooked_by, client_event_id)
  values
    (record_cooking_event.recipe_id, caller_household_id, record_cooking_event.cooked_at,
     record_cooking_event.note, auth.uid(), record_cooking_event.client_event_id)
  on conflict (client_event_id) do update
    set cooked_at = excluded.cooked_at,
        note = excluded.note
    where public.cooking_events.household_id = caller_household_id
  returning * into result_event;

  if result_event is null then
    raise exception 'cooking event belongs to a different household' using errcode = 'P0001';
  end if;

  return result_event;
end;
$$;

revoke all on function public.record_cooking_event(uuid, timestamptz, text, uuid) from public;
grant execute on function public.record_cooking_event(uuid, timestamptz, text, uuid) to authenticated;

-- COOK-05's "optional removal from This Week" after Done Cooking, from a
-- *confirmed* plan. remove_planning_entry (Phase 12) is deliberately
-- restricted to 'planning' state — that migration's own comment flagged
-- this as the separate RPC Phase 15 would add, rather than a reason to
-- loosen it. Never touches recipes.planned_count: FREQ-01 bases
-- Frequently Selected on planned count, not cooking count, so removing a
-- recipe after cooking it must not retroactively undo what confirming
-- the plan already counted.
create or replace function public.remove_confirmed_planning_entry(entry_id uuid)
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
    and wp.status = 'confirmed';

  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'planning entry not found or not removable' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.remove_confirmed_planning_entry(uuid) from public;
grant execute on function public.remove_confirmed_planning_entry(uuid) to authenticated;
