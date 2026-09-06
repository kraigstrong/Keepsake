-- ADR-0028: the data half of account deletion. One transaction, so a
-- partial failure rolls back to an intact, usable account. The auth.users
-- row is deleted separately by an Edge Function once this has committed.

-- The incomplete-deletion marker. Its own table rather than a column on
-- profiles: profiles.display_name is not null with a non-empty check, so
-- a surviving profile row cannot be stripped of the person it names. This
-- carries a user reference and a timestamp and has no name column at all,
-- so it cannot leak an identity even if a later migration forgets to.
create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table public.account_deletions enable row level security;

-- Read-your-own only. The client observes this mid-recovery, when it has
-- no household and no profile, so it needs an explicit own-row rule --
-- and a blanket select grant would hand every authenticated caller a
-- census of who deleted their account and when. No insert/update/delete
-- policy at all: only the security definer function below writes here.
create policy account_deletions_select_own on public.account_deletions
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.account_deletions to authenticated;

-- Advisory read, for the confirmation screen. The answer is not
-- authoritative -- delete_own_account re-derives it under a lock -- but
-- the screen has to say plainly which of the two deletions is about to
-- happen, because they differ in what the person loses.
create or replace function public.prepare_account_deletion()
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  caller_household_id uuid := public.my_household_id();
  member_count integer;
begin
  if caller_household_id is null then
    return 'no_household';
  end if;

  select count(*) into member_count
  from public.household_membership
  where household_id = caller_household_id;

  return case when member_count <= 1 then 'sole' else 'shared' end;
end;
$$;

revoke all on function public.prepare_account_deletion() from public;
grant execute on function public.prepare_account_deletion() to authenticated;

-- expected_mode is the answer prepare gave, passed back as a fence
-- (ADR-0020's claim_token shape applied to a boolean). If the household
-- went from sole to shared between the two calls -- someone accepted an
-- invitation while the confirmation screen was open -- this aborts rather
-- than destroying a library that now belongs to someone else too.
create or replace function public.delete_own_account(expected_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_household_id uuid;
  member_count integer;
  actual_mode text;
begin
  if caller_id is null then
    raise exception 'not authenticated' using errcode = 'P0001';
  end if;

  -- Not a precondition check. A caller with no membership row is not an
  -- error: it is someone whose previous attempt got this far and no
  -- further. Every step below is a no-op on an already-empty state, so
  -- the contract is a postcondition -- when this returns, the caller's
  -- data is gone -- and re-running it completes a half-finished deletion
  -- rather than failing on one.
  caller_household_id := public.my_household_id();

  if caller_household_id is not null then
    -- Lock before counting. accept_invitation takes `for update` on the
    -- invitation row only, so acceptance and deletion otherwise serialize
    -- on nothing meaningful: a sole member deleting their account at the
    -- moment an invitee taps their link could count one member, then
    -- destroy a household that has just become shared.
    perform 1 from public.households where id = caller_household_id for update;

    select count(*) into member_count
    from public.household_membership
    where household_id = caller_household_id;

    actual_mode := case when member_count <= 1 then 'sole' else 'shared' end;

    if actual_mode <> expected_mode then
      raise exception 'household membership changed since confirmation'
        using errcode = 'P0001';
    end if;

    if actual_mode = 'sole' then
      -- Recipes first, while the household they point at still exists.
      -- Cascading into recipes from the households delete fires
      -- record_deleted_recipe(), which writes a tombstone referencing a
      -- household midway through being deleted, and the whole delete
      -- fails on that foreign key. Pinned in attribution_detaches.test.sql.
      delete from public.recipes where household_id = caller_household_id;
      delete from public.households where id = caller_household_id;
    else
      -- The household and everything in it belongs to the people staying.
      -- The only rows removed are this caller's own: their private drafts
      -- and their membership. Their contributions stay, attribution
      -- detached, per ADR-0028 decision 1.
      delete from public.recipe_drafts where user_id = caller_id;
      delete from public.household_membership where user_id = caller_id;
    end if;
  end if;

  delete from public.profiles where id = caller_id;

  insert into public.account_deletions (user_id)
  values (caller_id)
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.delete_own_account(text) from public;
grant execute on function public.delete_own_account(text) to authenticated;
