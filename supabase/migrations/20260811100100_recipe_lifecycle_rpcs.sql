-- Phase 16 (ADR-0025): five narrow RPCs, same SECURITY DEFINER +
-- re-derive-household-from-auth.uid() shape every mutating RPC has used
-- since Phase 12 — never trust a client-supplied household_id.

-- Idempotent by construction: coalesce(archived_at, now()) preserves the
-- true first-archive timestamp across a retried call rather than
-- bumping it forward each time. Rejects an already-deleted recipe —
-- Recently Deleted has no "also archive this" action, so the server
-- enforces that rather than only trusting the client not to offer it.
create or replace function public.archive_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.recipes
  set archived_at = coalesce(archived_at, now()), updated_at = now()
  where id = recipe_id and household_id = caller_household_id and deleted_at is null
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.archive_recipe(uuid) from public;
grant execute on function public.archive_recipe(uuid) to authenticated;

create or replace function public.unarchive_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.recipes
  set archived_at = null, updated_at = now()
  where id = recipe_id and household_id = caller_household_id and deleted_at is null
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.unarchive_recipe(uuid) from public;
grant execute on function public.unarchive_recipe(uuid) to authenticated;

-- Soft delete (LIFE-04): works on a recipe regardless of archived_at
-- (decision 1 — the two states are independent), and is itself
-- idempotent (coalesce, same reasoning as archive_recipe). No
-- confirmation logic here — that's a client-side gate (ADR-0025
-- decision 9), this RPC just performs the action once asked.
create or replace function public.delete_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.recipes
  set deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = recipe_id and household_id = caller_household_id
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.delete_recipe(uuid) from public;
grant execute on function public.delete_recipe(uuid) to authenticated;

-- LIFE-06. ADR-0025's amendment: if another *active* recipe in the same
-- household has since taken over this one's source_url (a re-import
-- after this recipe was deleted), restoring would collide with
-- recipes_household_source_url_idx. Rather than let that raise, this
-- detaches the source_url on the restored row (sets it null) and keeps
-- going — the user asked to get their recipe back, not to arbitrate
-- which copy owns a URL. Only recipe_id changes what's compared;
-- source_attribution is untouched either way.
--
-- Amended (Codex review, PR #49): the url_taken EXISTS check above is a
-- plain, non-locking read — a concurrent import of the same URL between
-- that check and the UPDATE below committing could still find url_taken
-- false and then hit the unique-index violation this whole amendment
-- exists to avoid. Catching unique_violation and retrying once with
-- source_url forced to null closes that gap unconditionally: null is
-- excluded from the partial unique index, so the retry can never
-- collide, regardless of how the race actually interleaved.
create or replace function public.restore_recipe(recipe_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_recipe public.recipes;
  target_source_url text;
  url_taken boolean;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select r.source_url into target_source_url
  from public.recipes r
  where r.id = restore_recipe.recipe_id
    and r.household_id = caller_household_id
    and r.deleted_at is not null;

  if not found then
    raise exception 'recipe not found or not deleted' using errcode = 'P0001';
  end if;

  url_taken := target_source_url is not null and exists (
    select 1 from public.recipes other
    where other.household_id = caller_household_id
      and other.source_url = target_source_url
      and other.deleted_at is null
      and other.id <> restore_recipe.recipe_id
  );

  begin
    update public.recipes
    set deleted_at = null,
        source_url = case when url_taken then null else source_url end,
        updated_at = now()
    where id = restore_recipe.recipe_id and household_id = caller_household_id
    returning * into result_recipe;
  exception when unique_violation then
    update public.recipes
    set deleted_at = null,
        source_url = null,
        updated_at = now()
    where id = restore_recipe.recipe_id and household_id = caller_household_id
    returning * into result_recipe;
  end;

  -- Codex review, PR #49: without this, a row that vanished between the
  -- SELECT above and this UPDATE (e.g. a concurrent
  -- permanently_delete_recipe on the same id) would silently return a
  -- null result_recipe instead of raising — every sibling RPC in this
  -- file already guards its final write this way, this one just missed
  -- it originally.
  if result_recipe is null then
    raise exception 'recipe not found or not deleted' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.restore_recipe(uuid) from public;
grant execute on function public.restore_recipe(uuid) to authenticated;

-- LIFE-07. Only reachable from an already-deleted recipe (decision 3) —
-- never a direct one-step nuke from Library. A real DELETE; Phase 6's
-- existing deleted_recipes trigger (ADR-0013) fires exactly as already
-- built, nothing new to wire up for tombstones/offline sync. Returns
-- the row's storage paths (not deleted here — this function has no
-- Storage access) so the client can clean those objects up itself
-- (decision 4).
--
-- Idempotent per this phase's own "Idempotent destructive requests"
-- security bullet, but not by treating every 0-row outcome the same —
-- that would silently swallow a genuine "not deleted yet" or wrong-
-- household call, same failure modes remove_planning_entry/
-- remove_confirmed_planning_entry (Phase 12/15) both raise on rather
-- than absorb. Instead: a recipe that still exists but isn't deleted
-- raises; a recipe that isn't found at all is checked against the
-- deleted_recipes tombstone (ADR-0013) — a tombstone under this
-- household means this exact id was already permanently deleted by an
-- earlier successful call (a safe retry, returns quietly), no tombstone
-- means the id is bogus or belongs to a different household (raises,
-- same as every other RPC's household check).
--
-- Amended (Codex review, PR #49): the original version re-derived these
-- outcomes from a separate SELECT taken before the DELETE, which left a
-- TOCTOU gap — a concurrent restore_recipe between that SELECT and this
-- statement's own DELETE could clear deleted_at on the row, and the
-- DELETE below (filtered only on id/household, not deleted_at) would
-- still remove the now-active recipe. `deleted_at is not null` now lives
-- in the DELETE's own WHERE clause, so the deleted-state check and the
-- delete are the same atomic statement; every outcome below is derived
-- from whether *that* statement found a row, not from an earlier read.
create or replace function public.permanently_delete_recipe(recipe_id uuid)
returns table (hero_image_path text, original_photo_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  still_exists boolean;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  return query
    delete from public.recipes r
    where r.id = permanently_delete_recipe.recipe_id
      and r.household_id = caller_household_id
      and r.deleted_at is not null
    returning r.hero_image_path, r.original_photo_path;

  if found then
    return;
  end if;

  -- Nothing deleted: distinguish "still active" (never soft-deleted, or
  -- restored out from under a racing call) from "already permanently
  -- deleted by an earlier call" from "bogus id / wrong household".
  select exists (
    select 1 from public.recipes r
    where r.id = permanently_delete_recipe.recipe_id and r.household_id = caller_household_id
  ) into still_exists;

  if still_exists then
    raise exception 'recipe is not deleted' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.deleted_recipes dr
    where dr.id = permanently_delete_recipe.recipe_id and dr.household_id = caller_household_id
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;
  -- already permanently deleted by an earlier call — quiet retry
end;
$$;

revoke all on function public.permanently_delete_recipe(uuid) from public;
grant execute on function public.permanently_delete_recipe(uuid) to authenticated;
