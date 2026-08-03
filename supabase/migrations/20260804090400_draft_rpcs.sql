-- upsert_draft/delete_draft (ADR-0011) — recipe_drafts' only write path,
-- so household_id and user_id are always caller-derived (ADR-0008's
-- rule), never a client-supplied value. Reads don't need an RPC: the
-- schema migration's RLS policy already scopes select to
-- user_id = auth.uid(), which is enough on its own for read access.
create or replace function public.upsert_draft(recipe_id_param uuid, draft_payload_param jsonb)
returns public.recipe_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_draft public.recipe_drafts;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  if recipe_id_param is not null and not exists (
    select 1 from public.recipes where id = recipe_id_param and household_id = caller_household_id
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  update public.recipe_drafts
  set draft_payload = draft_payload_param, updated_at = now()
  where user_id = auth.uid()
    and (
      (recipe_id_param is null and recipe_id is null)
      or recipe_id = recipe_id_param
    )
  returning * into result_draft;

  if not found then
    insert into public.recipe_drafts (recipe_id, user_id, household_id, draft_payload)
    values (recipe_id_param, auth.uid(), caller_household_id, draft_payload_param)
    returning * into result_draft;
  end if;

  return result_draft;
end;
$$;

revoke all on function public.upsert_draft(uuid, jsonb) from public;
grant execute on function public.upsert_draft(uuid, jsonb) to authenticated;

create or replace function public.delete_draft(recipe_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.recipe_drafts
  where user_id = auth.uid()
    and (
      (recipe_id_param is null and recipe_id is null)
      or recipe_id = recipe_id_param
    );
end;
$$;

revoke all on function public.delete_draft(uuid) from public;
grant execute on function public.delete_draft(uuid) to authenticated;
