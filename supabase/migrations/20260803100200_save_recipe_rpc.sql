-- The only way a recipe is created or edited (ADR-0008/ADR-0010).
-- Household-scoped re-derivation from the caller (never trusts a
-- client-supplied household_id), and a single atomic transaction: the
-- recipe row plus every ingredient/instruction section/line and
-- category link, or nothing. Editing wipes and re-inserts the child
-- rows rather than diffing them — simpler and still atomic, since child
-- rows have no identity of their own that anything else references.
--
-- Payload shape (jsonb):
-- {
--   "id": uuid | null,            -- null = create, otherwise must be an
--                                  -- existing recipe in the caller's household
--   "title": text,
--   "heroImagePath": text | null,
--   "activeTimeMinutes": int | null,
--   "totalTimeMinutes": int | null,
--   "yieldText": text | null,
--   "permanentNotes": text | null,
--   "sourceUrl": text | null,
--   "sourceAttribution": text | null,
--   "tags": text[],
--   "categoryIds": uuid[],
--   "ingredientSections": [{ "title": text | null, "lines": text[] }],
--   "instructionSections": [{ "title": text | null, "lines": text[] }]
-- }
create or replace function public.save_recipe(payload jsonb)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_recipe_id uuid;
  result_recipe public.recipes;
  section_row record;
  line_row record;
  new_section_id uuid;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  target_recipe_id := (payload->>'id')::uuid;

  if target_recipe_id is not null then
    if not exists (
      select 1 from public.recipes
      where id = target_recipe_id and household_id = caller_household_id
    ) then
      raise exception 'recipe not found' using errcode = 'P0001';
    end if;

    update public.recipes set
      title = payload->>'title',
      hero_image_path = payload->>'heroImagePath',
      active_time_minutes = (payload->>'activeTimeMinutes')::int,
      total_time_minutes = (payload->>'totalTimeMinutes')::int,
      yield_text = payload->>'yieldText',
      permanent_notes = payload->>'permanentNotes',
      source_url = payload->>'sourceUrl',
      source_attribution = payload->>'sourceAttribution',
      tags = (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(coalesce(payload->'tags', '[]'::jsonb))
      ),
      updated_at = now()
    where id = target_recipe_id
    returning * into result_recipe;

    delete from public.recipe_ingredient_sections where recipe_id = target_recipe_id;
    delete from public.recipe_instruction_sections where recipe_id = target_recipe_id;
    delete from public.recipe_categories where recipe_id = target_recipe_id;
  else
    insert into public.recipes (
      household_id, title, hero_image_path, active_time_minutes, total_time_minutes,
      yield_text, permanent_notes, source_url, source_attribution, tags, created_by
    )
    values (
      caller_household_id,
      payload->>'title',
      payload->>'heroImagePath',
      (payload->>'activeTimeMinutes')::int,
      (payload->>'totalTimeMinutes')::int,
      payload->>'yieldText',
      payload->>'permanentNotes',
      payload->>'sourceUrl',
      payload->>'sourceAttribution',
      (
        select coalesce(array_agg(value), '{}')
        from jsonb_array_elements_text(coalesce(payload->'tags', '[]'::jsonb))
      ),
      auth.uid()
    )
    returning * into result_recipe;

    target_recipe_id := result_recipe.id;
  end if;

  for section_row in
    select value as section, ordinality - 1 as idx
    from jsonb_array_elements(coalesce(payload->'ingredientSections', '[]'::jsonb)) with ordinality
  loop
    insert into public.recipe_ingredient_sections (recipe_id, household_id, title, sort_order)
    values (target_recipe_id, caller_household_id, section_row.section->>'title', section_row.idx)
    returning id into new_section_id;

    for line_row in
      select value as line_text, ordinality - 1 as idx
      from jsonb_array_elements_text(coalesce(section_row.section->'lines', '[]'::jsonb)) with ordinality
    loop
      insert into public.recipe_ingredients (section_id, household_id, line_text, sort_order)
      values (new_section_id, caller_household_id, line_row.line_text, line_row.idx);
    end loop;
  end loop;

  for section_row in
    select value as section, ordinality - 1 as idx
    from jsonb_array_elements(coalesce(payload->'instructionSections', '[]'::jsonb)) with ordinality
  loop
    insert into public.recipe_instruction_sections (recipe_id, household_id, title, sort_order)
    values (target_recipe_id, caller_household_id, section_row.section->>'title', section_row.idx)
    returning id into new_section_id;

    for line_row in
      select value as line_text, ordinality - 1 as idx
      from jsonb_array_elements_text(coalesce(section_row.section->'lines', '[]'::jsonb)) with ordinality
    loop
      insert into public.recipe_instructions (section_id, household_id, line_text, sort_order)
      values (new_section_id, caller_household_id, line_row.line_text, line_row.idx);
    end loop;
  end loop;

  insert into public.recipe_categories (recipe_id, category_id, household_id)
  select target_recipe_id, (value)::uuid, caller_household_id
  from jsonb_array_elements_text(coalesce(payload->'categoryIds', '[]'::jsonb));

  return result_recipe;
end;
$$;

revoke all on function public.save_recipe(jsonb) from public;
grant execute on function public.save_recipe(jsonb) to authenticated;
