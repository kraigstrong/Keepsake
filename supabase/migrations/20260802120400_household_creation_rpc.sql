-- The only way a household or its first membership row comes into
-- existence (ADR-0008): both inserts happen in one transaction, and
-- re-derives the caller from auth.uid() rather than trusting an argument,
-- since this runs as SECURITY DEFINER.
create or replace function public.create_household()
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household public.households;
begin
  if exists (
    select 1 from public.household_membership where user_id = auth.uid()
  ) then
    raise exception 'user already belongs to a household'
      using errcode = 'P0001';
  end if;

  insert into public.households default values
  returning * into new_household;

  insert into public.household_membership (household_id, user_id)
  values (new_household.id, auth.uid());

  return new_household;
end;
$$;

revoke all on function public.create_household() from public;
grant execute on function public.create_household() to authenticated;
