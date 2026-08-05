-- Phase 10 (ADR-0017): adds the photo/camera import path alongside the
-- existing URL path. Two additive columns:
--
-- recipes.original_photo_path (IMG-02/IMG-03) — the EXIF-stripped,
-- large-but-not-full-resolution copy of whatever the user captured/
-- picked, stored separately from hero_image_path so replacing or
-- removing the hero image (Phase 4, reused per execution-plan.md) never
-- touches the preserved original. Only ever set at creation time by
-- save_recipe's insert branch (see below) — edits never touch it.
--
-- import_jobs.photo_path — mirrors source_url's role for the URL path,
-- but points at an already-uploaded Storage object (ADR-0017 decision
-- 2: upload-before-processing) rather than a remote URL. Exactly one of
-- source_url/photo_path is expected per job; normalized_url has no
-- meaning for a photo-sourced job (nothing to normalize), so it becomes
-- nullable too.

alter table public.recipes
  add column original_photo_path text;

alter table public.import_jobs
  alter column source_url drop not null,
  alter column normalized_url drop not null,
  add column photo_path text;

alter table public.import_jobs
  add constraint import_jobs_source_url_xor_photo_path
  check (
    (source_url is not null and photo_path is null)
    or (source_url is null and photo_path is not null)
  );

-- create_import_job gains a photo_path parameter (default null, so the
-- existing URL-path call sites keep working unchanged) — same
-- signature-change handling ADR-0016 already used: the old arity has to
-- be dropped explicitly, since Postgres resolves an exact-arity match
-- ahead of a default-filled one.
drop function if exists public.create_import_job(text, text, uuid);

create or replace function public.create_import_job(
  source_url text default null,
  normalized_url text default null,
  client_import_id uuid default null,
  photo_path text default null
)
returns public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_job public.import_jobs;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  if (source_url is null) = (photo_path is null) then
    raise exception 'exactly one of source_url or photo_path is required' using errcode = 'P0001';
  end if;

  -- Idempotent replay: a client-supplied id already seen for this
  -- household returns the existing row as-is (whatever its current
  -- status), instead of inserting a duplicate or erroring. This isn't a
  -- new import attempt, so it skips the cooldown/cap guards below
  -- entirely rather than competing with real new imports for headroom.
  if client_import_id is not null then
    select * into result_job
    from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.client_import_id = create_import_job.client_import_id;

    if found then
      return result_job;
    end if;
  end if;

  if exists (
    select 1 from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'please wait before importing another recipe' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'too many imports for this household in the last hour' using errcode = 'P0001';
  end if;

  insert into public.import_jobs (
    household_id, created_by, source_url, normalized_url, client_import_id, photo_path
  )
  values (
    caller_household_id,
    auth.uid(),
    create_import_job.source_url,
    create_import_job.normalized_url,
    create_import_job.client_import_id,
    create_import_job.photo_path
  )
  returning * into result_job;

  return result_job;
end;
$$;

revoke all on function public.create_import_job(text, text, uuid, text) from public;
grant execute on function public.create_import_job(text, text, uuid, text) to authenticated;

-- save_recipe: only the insert (create) branch gains original_photo_path
-- — deliberately absent from the update branch's SET clause, so editing
-- a recipe can never blank out or change the preserved original
-- (ADR-0017 consequences: hero-image replace/remove must never affect
-- it, and the same holds for any other edit).
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
      total_time_minutes, yield_text, permanent_notes, source_url, source_attribution,
      tags, created_by
    )
    values (
      caller_household_id,
      payload->>'title',
      payload->>'heroImagePath',
      payload->>'originalPhotoPath',
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
