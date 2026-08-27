-- One locking discipline across the weekly-plan RPC family.
--
-- add_to_weekly_plan, add_recipes_to_weekly_plan and
-- reorder_planning_entries have taken `for update` on the plan row since
-- Phase 12 (Codex review, PR #36). confirm_weekly_plan and
-- remove_planning_entry never did, so apply_selection_round — which locks
-- the plan before filtering duplicates — was serialised against the
-- adders but not against those two. Found by Codex on PR #101,
-- 2026-08-24, and deliberately merged over at the time; this closes it.
--
-- Two consequences, both silent:
--
--   * confirm interleaving with apply can leave a confirmed plan holding
--     `counted = false` entries whose `planned_count` was never
--     incremented. That number feeds FREQ-01 and the Smart Selection
--     ranking heuristic, so the drift is cumulative and nothing ever
--     surfaces it to a user who might report it.
--   * a concurrent remove can delete an entry apply had just filtered
--     out as a duplicate, leaving the round marked `applied` without its
--     recipe in the plan.
--
-- Pre-existing, not introduced by #101: these RPCs shipped this way in
-- Phase 12 and apply is merely the first caller whose correctness
-- depends on theirs.
--
-- reopen_weekly_plan is deliberately left alone: it is a single guarded
-- `update ... where status = 'confirmed'`, so Postgres re-evaluates the
-- predicate under its own row lock and there is no read-then-write gap
-- to close. Adding a lock there would be noise, not correctness.
--
-- Lock order is unchanged and remains acyclic: every function here takes
-- the weekly_plans row first and only then touches planning_entries or
-- recipes; apply_selection_round takes the selection round first, then
-- the plan, and nothing takes them in the opposite order.

-- Bodies below are byte-identical to their current definitions apart
-- from the added lock — no behaviour, error message, or errcode changes.

create or replace function public.remove_planning_entry(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_plan_id uuid;
  deleted_count integer;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  -- Resolve then lock the plan before the delete, matching
  -- remove_confirmed_planning_entry's existing shape. The delete's own
  -- join to weekly_plans reads a snapshot, so without this a concurrent
  -- confirm or apply is invisible to it.
  select pe.weekly_plan_id into target_plan_id
  from public.planning_entries pe
  where pe.id = entry_id and pe.household_id = caller_household_id;

  if target_plan_id is null then
    raise exception 'planning entry not found or not removable' using errcode = 'P0001';
  end if;

  perform 1 from public.weekly_plans where id = target_plan_id for update;

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

  -- Before the count: this function's whole body is a read-check-then-
  -- write over three tables, and the `counted = false` set it reads must
  -- not change under it. A no-op when the plan does not exist, so the
  -- entry_count check below still raises exactly as it did.
  perform 1 from public.weekly_plans
  where id = plan_id and household_id = caller_household_id
  for update;

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
