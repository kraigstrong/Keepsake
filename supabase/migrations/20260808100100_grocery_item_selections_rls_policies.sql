-- Read access only, same is_household_member() shape as every other
-- Phase 4+ table. No insert/update/delete grant for authenticated — the
-- write goes through set_grocery_item_selection (next migration), which
-- re-derives the caller's household from auth.uid() rather than
-- trusting a client-supplied household_id (same reasoning as
-- save_recipe / the weekly-plan RPCs).

create policy "Members can select their household's grocery item selections"
  on public.grocery_item_selections
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.grocery_item_selections to authenticated;
