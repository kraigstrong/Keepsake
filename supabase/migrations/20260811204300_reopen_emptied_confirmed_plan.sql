-- Developer walkthrough feedback, 2026-08-12: removing the last entry
-- from a confirmed plan (e.g. Cooking Mode's "remove from This Week" on
-- the last thing left to cook) used to leave weekly_plans.status stuck
-- at 'confirmed' with zero entries — This Week's own UI shows the
-- normal empty state either way, complete with its big "Add recipes"
-- button, but that button calls add_to_weekly_plan, which explicitly
-- rejects a non-'planning' plan. The only way forward was finding "Edit
-- Plan" first, a real dead-end the empty state itself never explained.
--
-- A confirmed plan with nothing left in it is functionally
-- indistinguishable from a fresh, never-planned week, so reopening it
-- automatically here removes the dead-end rather than requiring an
-- extra manual step to notice and work around it. Same "leave
-- confirmed_at and counted flags untouched" reasoning as the existing
-- reopen_weekly_plan ("Edit Plan") RPC — re-confirming later must not
-- double-count entries already counted once.
create or replace function public.remove_confirmed_planning_entry(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_plan_id uuid;
  remaining_count integer;
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
    and wp.status = 'confirmed'
  returning pe.weekly_plan_id into target_plan_id;

  if target_plan_id is null then
    raise exception 'planning entry not found or not removable' using errcode = 'P0001';
  end if;

  select count(*) into remaining_count
  from public.planning_entries
  where weekly_plan_id = target_plan_id;

  if remaining_count = 0 then
    update public.weekly_plans
    set status = 'planning', updated_at = now()
    where id = target_plan_id and status = 'confirmed';
  end if;
end;
$$;
