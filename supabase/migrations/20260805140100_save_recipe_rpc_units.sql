-- Phase 11 (ADR-0018): ingredient lines change shape from a bare string
-- to an object carrying the pre-parsed structured quantity fields
-- alongside the original text. Parsing happens client-side (or in the
-- import-recipe Edge Function for AI-extracted lines) via src/units/,
-- not here -- this RPC just stores what it's given, the same trust
-- posture it already had for line_text (household-scoped RLS is the
-- real write boundary, not the shape of the payload). Instruction
-- lines are unchanged (plain strings) -- instructions are steps, not
-- measured amounts, and are never fed through the quantity parser
-- (ADR-0018, "Temperature preservation").
--
-- ingredientSections[].lines[] shape changes from:
--   "2 lb baby potatoes, halved"
-- to:
--   {
--     "lineText": "2 lb baby potatoes, halved",
--     "quantityMin": 2, "quantityMax": 2, "unit": "lb",
--     "ingredientText": "baby potatoes, halved"
--   }
-- with quantityMin/quantityMax/unit/ingredientText all null for a line
-- the parser couldn't confidently read -- displayed as lineText
-- verbatim everywhere, never scaled or converted.
--
-- restore_recipe_version replays a stored recipe_versions.snapshot back
-- through this function (ADR-0011) -- snapshots taken before this
-- migration have ingredientSections[].lines as plain strings, frozen in
-- history and unable to "upgrade" the way a live caller can. The
-- ingredient-line insert below branches on jsonb_typeof so restoring a
-- pre-Phase-11 version still works: a string line restores with every
-- structured field null (unparsed, same safe fallback as any other
-- unparsed line), never a constraint violation.
--
-- Carries forward Phase 10's originalPhotoPath handling unchanged: only
-- the insert (create) branch sets it, deliberately absent from the
-- update branch's SET clause, so editing a recipe can never blank out
-- or change the preserved original (ADR-0017).
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
      household_id, title, hero_image_path, original_photo_path, active_time_minutes,
      total_time_minutes, yield_text, servings_count, permanent_notes, source_url,
      source_attribution, tags, created_by
    )
    values (
      caller_household_id,
      payload->>'title',
      payload->>'heroImagePath',
      payload->>'originalPhotoPath',
      (payload->>'activeTimeMinutes')::int,
      (payload->>'totalTimeMinutes')::int,
      payload->>'yieldText',
      (payload->>'servingsCount')::int,
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
      servings_count = (payload->>'servingsCount')::int,
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
      select value as line, ordinality - 1 as idx
      from jsonb_array_elements(coalesce(section_row.section->'lines', '[]'::jsonb)) with ordinality
    loop
      insert into public.recipe_ingredients (
        section_id, household_id, line_text, quantity_min, quantity_max, unit, ingredient_text, sort_order
      )
      values (
        new_section_id,
        caller_household_id,
        case when jsonb_typeof(line_row.line) = 'string'
          then line_row.line #>> '{}'
          else line_row.line->>'lineText'
        end,
        case when jsonb_typeof(line_row.line) = 'string'
          then null
          else (line_row.line->>'quantityMin')::numeric
        end,
        case when jsonb_typeof(line_row.line) = 'string'
          then null
          else (line_row.line->>'quantityMax')::numeric
        end,
        case when jsonb_typeof(line_row.line) = 'string'
          then null
          else line_row.line->>'unit'
        end,
        case when jsonb_typeof(line_row.line) = 'string'
          then null
          else line_row.line->>'ingredientText'
        end,
        line_row.idx
      );
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
