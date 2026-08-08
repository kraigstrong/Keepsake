-- Phase 13 (ADR-0022). One narrow RPC, same SECURITY DEFINER +
-- re-derive-household-from-auth.uid() shape as every other mutating
-- path in this codebase (save_recipe, the import job RPCs, the six
-- weekly-plan RPCs) — no bare RLS-permitted write exists for this
-- table, deliberately, for consistency with that pattern.
--
-- item_hash is an opaque identity computed client-side by
-- server/groceries (a deterministic hash of a canonical ingredient
-- key) — this function does not know or care what it means, only that
-- it uniquely identifies "the same" grocery item across regenerations
-- of a list this table never itself stores.
--
-- Restricted to a 'confirmed' plan, matching the product decision
-- (ADR-0022) that grocery review is only reachable once This Week is
-- confirmed — the same defense-in-depth posture add_to_weekly_plan
-- uses for its own 'planning'-only restriction, not just a client-side
-- gate.
create or replace function public.set_grocery_item_selection(
  plan_id uuid,
  item_hash text,
  included boolean
)
returns public.grocery_item_selections
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  plan_status text;
  result_selection public.grocery_item_selections;
begin
  if length(trim(item_hash)) = 0 then
    raise exception 'item_hash must not be empty' using errcode = 'P0001';
  end if;

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select status into plan_status
  from public.weekly_plans
  where id = plan_id and household_id = caller_household_id;
  if plan_status is null then
    raise exception 'weekly plan not found' using errcode = 'P0001';
  end if;
  if plan_status <> 'confirmed' then
    raise exception 'weekly plan is not confirmed' using errcode = 'P0001';
  end if;

  insert into public.grocery_item_selections
    (weekly_plan_id, household_id, item_hash, included, updated_by)
  values
    (plan_id, caller_household_id, set_grocery_item_selection.item_hash, included, auth.uid())
  on conflict (weekly_plan_id, item_hash) do update
    set included = excluded.included,
        updated_at = now(),
        updated_by = excluded.updated_by
  returning * into result_selection;

  return result_selection;
end;
$$;

revoke all on function public.set_grocery_item_selection(uuid, text, boolean) from public;
grant execute on function public.set_grocery_item_selection(uuid, text, boolean) to authenticated;
