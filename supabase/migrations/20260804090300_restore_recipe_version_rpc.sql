-- Restoring is an explicit, deliberate action, not the accidental
-- concurrent overwrite save_recipe's baseVersion check exists to
-- prevent (ADR-0011) — so this reapplies the snapshot through
-- save_recipe's own atomic path, supplying whatever the recipe's
-- *current* version actually is as the baseVersion. That makes the
-- check pass by construction (there's nothing to race against within
-- one transaction) without needing a bypass flag inside save_recipe
-- itself. save_recipe's own edit path increments the version and
-- appends a new recipe_versions row — restoring version 2 doesn't
-- delete or touch version 3, satisfying VER-04's "later history is
-- preserved" for free.
create or replace function public.restore_recipe_version(target_version_id uuid)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  version_row public.recipe_versions;
  current_version integer;
  restore_payload jsonb;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into version_row from public.recipe_versions
  where id = target_version_id and household_id = caller_household_id;

  if version_row is null then
    raise exception 'version not found' using errcode = 'P0001';
  end if;

  select version into current_version from public.recipes where id = version_row.recipe_id;

  restore_payload := version_row.snapshot
    || jsonb_build_object('id', version_row.recipe_id, 'baseVersion', current_version);

  return public.save_recipe(restore_payload);
end;
$$;

revoke all on function public.restore_recipe_version(uuid) from public;
grant execute on function public.restore_recipe_version(uuid) to authenticated;
