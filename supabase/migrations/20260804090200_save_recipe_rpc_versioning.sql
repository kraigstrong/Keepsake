-- Extends save_recipe (Phase 4) with optimistic concurrency and version
-- snapshots (ADR-0011). Edits now require a baseVersion — the version
-- the caller loaded — checked against the row's current version before
-- any write happens; a mismatch means someone else saved in between,
-- and the whole call fails atomically, same guarantee Phase 4's
-- atomicity test already proved for a bad category id. On success
-- (create or edit), the recipe's version increments (or starts at 1)
-- and the full payload is recorded as an immutable recipe_versions
-- snapshot, then any matching draft for that recipe is cleared — it's
-- now the real saved state, not a draft anymore.
--
-- Payload shape adds one field to Phase 4's:
-- {
--   ...(Phase 4's fields, unchanged),
--   "baseVersion": int  -- required when "id" is set (editing); ignored on create
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
  is_create boolean;
  base_version integer;
  current_version integer;
  new_version integer;
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
  is_create := target_recipe_id is null;

  if is_create then
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
    new_version := result_recipe.version;
  else
    select version into current_version from public.recipes
    where id = target_recipe_id and household_id = caller_household_id;

    if current_version is null then
      raise exception 'recipe not found' using errcode = 'P0001';
    end if;

    base_version := (payload->>'baseVersion')::int;
    if base_version is null then
      raise exception 'baseVersion is required when editing an existing recipe' using errcode = 'P0001';
    end if;

    if base_version != current_version then
      raise exception 'recipe has changed since it was loaded' using errcode = 'P0001';
    end if;

    new_version := current_version + 1;

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
      version = new_version,
      updated_at = now()
    where id = target_recipe_id
    returning * into result_recipe;

    delete from public.recipe_ingredient_sections where recipe_id = target_recipe_id;
    delete from public.recipe_instruction_sections where recipe_id = target_recipe_id;
    delete from public.recipe_categories where recipe_id = target_recipe_id;
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

  insert into public.recipe_versions (recipe_id, household_id, version_number, snapshot, created_by)
  values (
    target_recipe_id,
    caller_household_id,
    new_version,
    payload || jsonb_build_object('id', target_recipe_id),
    auth.uid()
  );

  if is_create then
    delete from public.recipe_drafts
    where user_id = auth.uid() and household_id = caller_household_id and recipe_id is null;
  else
    delete from public.recipe_drafts
    where user_id = auth.uid() and recipe_id = target_recipe_id;
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.save_recipe(jsonb) from public;
grant execute on function public.save_recipe(jsonb) to authenticated;
