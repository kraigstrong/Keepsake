-- SECURITY DEFINER: these read household_membership on behalf of the
-- caller regardless of what RLS would otherwise let them see, so that
-- policies built from them don't recurse through RLS on the very table
-- they're protecting. Each one re-derives identity from auth.uid()
-- itself — never take a caller-supplied user id as "who is asking".

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_membership
    where household_id = target_household_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

-- MVP excludes multiple households (prd.md §5), so "my household" is
-- well-defined; returns null for a signed-in user who hasn't joined one.
create or replace function public.my_household_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select household_id
  from public.household_membership
  where user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_household_id() from public;
grant execute on function public.my_household_id() to authenticated;

-- Backs the profiles select policy: household members can see each
-- other's display name, not just their own.
create or replace function public.shares_household_with(other_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_membership self
    join public.household_membership other on other.household_id = self.household_id
    where self.user_id = auth.uid()
      and other.user_id = other_user_id
  );
$$;

revoke all on function public.shares_household_with(uuid) from public;
grant execute on function public.shares_household_with(uuid) to authenticated;
