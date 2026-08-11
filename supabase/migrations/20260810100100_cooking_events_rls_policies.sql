-- Read access only, same is_household_member() helper as every other
-- Phase 4+ table. No insert/update/delete grant for authenticated —
-- writes go through record_cooking_event() (next migration), which
-- re-derives the caller's household from auth.uid() rather than trusting
-- a client-supplied household_id (same shape as save_recipe / the
-- weekly-plan RPCs).

create policy "Members can select their household's cooking events"
  on public.cooking_events
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.cooking_events to authenticated;
