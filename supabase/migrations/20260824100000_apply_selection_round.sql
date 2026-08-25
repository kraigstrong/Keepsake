-- Milestone 4 (ADR-0027 decision 6): apply_selection_round -- the round's
-- picks land in This Week. Highest-risk RPC in this milestone: it is the
-- only Smart Meal Selection write that touches data the user already
-- owns (their weekly plan). Builds on selection_round_lifecycle_rpcs.sql
-- (resolve_selection_round_deadline) and calls add_recipes_to_weekly_plan
-- (20260812150000) directly as a nested SECURITY DEFINER call, sharing
-- this transaction -- ADR-0020's finalize_import_job shape exactly.

create or replace function public.apply_selection_round(
  round_id uuid,
  weekly_plan_id uuid,
  selections jsonb
)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  locked_round public.selection_rounds;
  locked_plan_id uuid;
  eligible_recipe_ids uuid[];
  eligible_multipliers numeric[];
  result_round public.selection_rounds;
begin
  perform public.resolve_selection_round_deadline(apply_selection_round.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into locked_round
  from public.selection_rounds
  where id = apply_selection_round.round_id
    and household_id = caller_household_id
  for update;

  if locked_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  -- Idempotent replay (ADR-0020's finalize_import_job shape): a round
  -- already applied returns its stored applied_weekly_plan_id as-is
  -- rather than erroring or inserting a second time.
  if locked_round.status = 'applied' then
    return locked_round;
  end if;

  if locked_round.status <> 'ready_for_review' then
    raise exception 'selection round is not ready for review' using errcode = 'P0001';
  end if;

  -- ADR-0027 decision 6: lock the *target plan* before reading its
  -- entries, not after. add_recipes_to_weekly_plan takes this same lock
  -- itself, but only once it runs -- far too late, since it never
  -- rechecks for existing entries, so a concurrent direct add could land
  -- a duplicate between our filter below and its insert. Locking first
  -- makes read-filter-insert one atomic unit.
  select id into locked_plan_id
  from public.weekly_plans
  where id = apply_selection_round.weekly_plan_id
    and household_id = caller_household_id
  for update;

  if locked_plan_id is null then
    raise exception 'weekly plan not found' using errcode = 'P0001';
  end if;

  -- Every recipe_id must have actually been a candidate of this round
  -- (ADR-0027 decision 5's re-derive-never-trust rule, same as
  -- record_selection_decision) -- this is the one filter that's an
  -- error rather than a silent skip: a recipe_id absent from the deck
  -- did not come from this round's own UI.
  if exists (
    select 1
    from jsonb_array_elements(apply_selection_round.selections) as s
    where not exists (
      select 1 from public.selection_round_candidates c
      where c.round_id = apply_selection_round.round_id
        and c.recipe_id = (s ->> 'recipe_id')::uuid
    )
  ) then
    raise exception 'recipe is not a candidate of this round' using errcode = 'P0001';
  end if;

  -- Everything else is a silent filter, not an error: a candidate
  -- archived/deleted since the deck was built (decision 1 -- the deck
  -- itself is never mutated, availability is rechecked live) and a
  -- recipe already in the plan (someone else added it first is a normal
  -- outcome under the lock above, not a failure) both just drop out.
  -- distinct on collapses a client sending the same recipe_id twice in
  -- one call to a single insert.
  with deduped as (
    select distinct on ((s ->> 'recipe_id')::uuid)
      (s ->> 'recipe_id')::uuid as recipe_id,
      (s ->> 'multiplier')::numeric as multiplier,
      ord
    from jsonb_array_elements(apply_selection_round.selections) with ordinality as t(s, ord)
    order by (s ->> 'recipe_id')::uuid, ord
  )
  select array_agg(d.recipe_id order by d.ord), array_agg(d.multiplier order by d.ord)
  into eligible_recipe_ids, eligible_multipliers
  from deduped d
  where exists (
    select 1 from public.recipes r
    where r.id = d.recipe_id
      and r.household_id = caller_household_id
      and r.archived_at is null
      and r.deleted_at is null
  )
  and not exists (
    select 1 from public.planning_entries pe
    where pe.weekly_plan_id = apply_selection_round.weekly_plan_id
      and pe.recipe_id = d.recipe_id
  );

  -- Empty-filtered-set is success, not an error: every selection turning
  -- out to already be in the plan is the same outcome as one of them
  -- being a duplicate, just the all-of-them case -- an artificial
  -- threshold at "zero survived" would make the result depend on
  -- filtering luck rather than on anything the caller did wrong. The
  -- round still becomes applied either way (planned_count is untouched
  -- either way too -- it only increments in confirm_weekly_plan).
  if coalesce(array_length(eligible_recipe_ids, 1), 0) > 0 then
    perform public.add_recipes_to_weekly_plan(
      apply_selection_round.weekly_plan_id, eligible_recipe_ids, eligible_multipliers
    );
  end if;

  update public.selection_rounds
  set status = 'applied',
      applied_at = now(),
      applied_by = auth.uid(),
      applied_weekly_plan_id = apply_selection_round.weekly_plan_id,
      updated_at = now()
  where id = apply_selection_round.round_id
  returning * into result_round;

  return result_round;
end;
$$;

revoke all on function public.apply_selection_round(uuid, uuid, jsonb) from public;
grant execute on function public.apply_selection_round(uuid, uuid, jsonb) to authenticated;
