-- Read access scoped to household membership, same is_household_member()
-- helper as Phase 3. No insert/update/delete grant on any recipe table
-- for authenticated — every write goes through the save_recipe RPC
-- (next migration), which re-derives the caller's household itself
-- rather than trusting a client-supplied household_id.

create policy "Members can select their household's recipes"
  on public.recipes
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipes to authenticated;

create policy "Members can select their household's ingredient sections"
  on public.recipe_ingredient_sections
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_ingredient_sections to authenticated;

create policy "Members can select their household's ingredients"
  on public.recipe_ingredients
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_ingredients to authenticated;

create policy "Members can select their household's instruction sections"
  on public.recipe_instruction_sections
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_instruction_sections to authenticated;

create policy "Members can select their household's instructions"
  on public.recipe_instructions
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_instructions to authenticated;

create policy "Members can select their household's recipe categories"
  on public.recipe_categories
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.recipe_categories to authenticated;

-- categories itself is a global shared taxonomy, not household-scoped —
-- every signed-in user reads the same list.
create policy "Authenticated users can select the category taxonomy"
  on public.categories
  for select
  to authenticated
  using (true);

grant select on public.categories to authenticated;
