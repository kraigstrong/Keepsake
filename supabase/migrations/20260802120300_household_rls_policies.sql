-- profiles: visible to yourself and anyone who shares your household
-- (so a member list can show names, not just user ids); only ever
-- writable by yourself.
create policy "Users can select their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "Users can select profiles of their household members"
  on public.profiles
  for select
  to authenticated
  using (public.shares_household_with(id));

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, insert, update on public.profiles to authenticated;

-- households: readable by members; deliberately no insert/update/delete
-- policy or grant for `authenticated` — creation and membership changes
-- go through SECURITY DEFINER RPCs (ADR-0008), never a direct client
-- write to these tables.
create policy "Members can select their household"
  on public.households
  for select
  to authenticated
  using (public.is_household_member(id));

grant select on public.households to authenticated;

-- household_membership: readable by fellow members (the roster);
-- same "no direct client write" rule as households above — rows are
-- only ever inserted by the household-creation and invitation-
-- acceptance RPCs.
create policy "Members can select their household's roster"
  on public.household_membership
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.household_membership to authenticated;
