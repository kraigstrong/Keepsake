-- Phase 16 follow-up (Codex review, PR #53): the lifecycle RPCs
-- reauthorize every call via auth.uid() but never recorded it anywhere,
-- so nothing was queryable afterward about who archived, deleted, or
-- restored a recipe -- unlike this app's own established pattern for
-- exactly this (planning_entries.added_by, Phase 12; cooking_events.
-- cooked_by, Phase 15). Closes the "Auditable actor and identifiers
-- without recipe contents" security bullet from Phase 16's own
-- checklist (docs/execution-plan.md), missed by the original Phase 16
-- PRs. Deliberately server-side only -- no MVP surface displays "who
-- archived this," so these columns aren't added to the local SQLite
-- mirror or synced to clients.

alter table public.recipes add column archived_by uuid references auth.users (id);
alter table public.recipes add column deleted_by uuid references auth.users (id);
alter table public.recipes add column restored_by uuid references auth.users (id);

alter table public.deleted_recipes add column deleted_by uuid references auth.users (id);

-- record_deleted_recipe fires as a BEFORE DELETE trigger in the same
-- transaction as whichever RPC issued the DELETE (only
-- permanently_delete_recipe, today) -- auth.uid() here resolves to
-- that RPC's own caller, the actor performing the actual irreversible
-- action. Deliberately not OLD.deleted_by: that would only say who
-- most recently soft-deleted the row, a different and less important
-- fact for a tombstone whose whole point is the permanent-delete event.
create or replace function public.record_deleted_recipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deleted_recipes (id, household_id, deleted_by)
  values (old.id, old.household_id, auth.uid());
  return old;
end;
$$;

-- archive_recipe / unarchive_recipe: archived_by mirrors archived_at's
-- own lifecycle exactly -- coalesced on archive (same idempotency
-- reasoning as archived_at itself: a retried call by the same caller
-- shouldn't overwrite the original actor), cleared on unarchive so a
-- later archive by a different household member isn't stuck showing
-- the first archiver.
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
  set archived_at = coalesce(archived_at, now()),
      archived_by = coalesce(archived_by, auth.uid()),
      updated_at = now()
  where id = recipe_id and household_id = caller_household_id and deleted_at is null
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

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
  set archived_at = null,
      archived_by = null,
      updated_at = now()
  where id = recipe_id and household_id = caller_household_id and deleted_at is null
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

-- delete_recipe: deleted_by mirrors deleted_at's own coalesce-
-- idempotency. restore_recipe (below) clears both deleted_at and
-- deleted_by, so a later delete-by-a-different-member's coalesce here
-- never inherits a stale actor left over from an earlier
-- delete/restore cycle on the same recipe.
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
  set deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, auth.uid()),
      updated_at = now()
  where id = recipe_id and household_id = caller_household_id
  returning * into result_recipe;

  if result_recipe is null then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;

-- restore_recipe: deleted_by is cleared here (not coalesced -- see
-- delete_recipe's own comment for why that matters for the next
-- cycle). restored_by is set unconditionally, not coalesced: unlike
-- every sibling RPC in this file, restore_recipe was never idempotent
-- against a second call in the first place (its opening SELECT already
-- requires deleted_at is not null, unchanged by this migration), so
-- every successful call here really is a first-and-only restore, not a
-- possible retry.
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
        deleted_by = null,
        restored_by = auth.uid(),
        source_url = case when url_taken then null else source_url end,
        updated_at = now()
    where id = restore_recipe.recipe_id and household_id = caller_household_id
    returning * into result_recipe;
  exception when unique_violation then
    update public.recipes
    set deleted_at = null,
        deleted_by = null,
        restored_by = auth.uid(),
        source_url = null,
        updated_at = now()
    where id = restore_recipe.recipe_id and household_id = caller_household_id
    returning * into result_recipe;
  end;

  if result_recipe is null then
    raise exception 'recipe not found or not deleted' using errcode = 'P0001';
  end if;

  return result_recipe;
end;
$$;
