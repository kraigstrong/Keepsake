-- Phase 13 (ADR-0022). Two narrow RPCs, same SECURITY DEFINER +
-- re-derive-household-from-auth.uid() shape as every other mutating
-- path in this codebase (save_recipe, the import job RPCs, the six
-- weekly-plan RPCs) — no bare RLS-permitted write exists for this
-- table, deliberately, for consistency with that pattern.
--
-- item_hash_param is an opaque identity computed client-side by
-- server/groceries — an FNV-1a 64-bit hash, always 16 lowercase hex
-- characters (server/groceries/itemHash.ts). Validated against that
-- exact format rather than merely "non-empty": a buggy or malicious
-- authenticated client could otherwise pass arbitrary text, and since
-- each distinct value creates a new indexed row, that would let one
-- plan accumulate unbounded junk (Codex review, PR #45). Named with
-- the _param suffix — not because a WHERE/VALUES reference is
-- ambiguous (those can be schema-qualified, e.g.
-- set_grocery_item_selection.item_hash), but because an ON CONFLICT
-- target column list only ever names table columns and can't be
-- qualified that way, so a same-named parameter there is genuinely
-- ambiguous to the planner — same collision ADR-0021 already hit with
-- week_key_param, and the exact bug this migration originally shipped
-- with (caught by CI, not local review — no Docker in this environment
-- to run pgTAP before pushing).
create or replace function public.set_grocery_item_selection(
  plan_id uuid,
  item_hash_param text,
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
  if item_hash_param !~ '^[0-9a-f]{16}$' then
    raise exception 'item_hash_param must be a 16-character lowercase hex hash' using errcode = 'P0001';
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
    (plan_id, caller_household_id, item_hash_param, included, auth.uid())
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

-- Clears an explicit override, restoring an item to its client-computed
-- default (staple -> excluded, else included) — keeps the table sparse
-- as ADR-0022 actually intends (a row means "the household chose
-- something other than the default", not "the household has an
-- opinion at all"), and means a future tuning of the staples list
-- applies retroactively to anyone who never overrode that item,
-- instead of being masked by a stale row recording today's default as
-- if it were a deliberate choice (Codex review, PR #45). A no-op
-- (rather than an error) when no override exists — clearing an
-- already-default item is a normal outcome, not a client bug, the same
-- idempotent-by-construction posture confirm_weekly_plan already uses.
create or replace function public.clear_grocery_item_selection(
  plan_id uuid,
  item_hash_param text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  plan_status text;
begin
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

  delete from public.grocery_item_selections
  where weekly_plan_id = plan_id
    and household_id = caller_household_id
    and item_hash = item_hash_param;
end;
$$;

revoke all on function public.clear_grocery_item_selection(uuid, text) from public;
grant execute on function public.clear_grocery_item_selection(uuid, text) to authenticated;
