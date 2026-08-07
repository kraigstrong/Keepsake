-- Read access only, same is_household_member() helper as every other
-- Phase 4+ table. No insert/update/delete grant for authenticated —
-- every write goes through the RPCs in the next migration, which
-- re-derive the caller's household from auth.uid() themselves rather
-- than trusting a client-supplied household_id (same reasoning as
-- save_recipe / import_jobs).

create policy "Members can select their household's weekly plans"
  on public.weekly_plans
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.weekly_plans to authenticated;

create policy "Members can select their household's planning entries"
  on public.planning_entries
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.planning_entries to authenticated;
