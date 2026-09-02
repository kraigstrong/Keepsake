-- Starter recipes: one optional, once-per-household seed of a brand-new
-- library. Full reasoning in docs/proposals/starter-recipes.md.
--
-- The content itself lives client-side as typed TypeScript and arrives
-- here already parsed. That split is forced by ADR-0018: ingredient
-- lines are stored pre-parsed and parsing happens in TypeScript, never
-- in SQL, so content in a migration would mean hand-writing
-- quantity_min/unit/ingredient_text and freezing a parser that is still
-- being fixed.
--
-- This RPC owns the two things the client cannot be trusted with: the
-- household boundary and atomicity. It grants no capability a caller
-- did not already have -- anyone with a JWT can call save_recipe
-- directly -- so the security question here is scoping and idempotency,
-- not new power.

alter table public.households
  add column if not exists starter_recipes_seeded_at timestamptz;

comment on column public.households.starter_recipes_seeded_at is
  'Set once by seed_starter_recipes. Also read by the client to suppress the
   offer, so a household that seeds and then empties its library gets the plain
   empty state rather than a button that can only ever no-op.';

-- Returns rather than raises on a repeat call: a lost response followed
-- by a retry should look like success to the client, because it is --
-- the recipes are there.
create or replace function public.seed_starter_recipes(payload jsonb)
returns table (seeded boolean, recipe_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  existing_stamp timestamptz;
  recipe_row record;
  resolved_category_ids jsonb;
  saved_count int := 0;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  -- Fail fast, before the lock and before any work. The stamp already
  -- limits this to once per household forever, so no cooldown or rolling
  -- window is warranted -- these are shape checks, not rate limits.
  --
  -- Both bounds, and both before the lock. The upper one stops a
  -- malformed call doing arbitrary work. The lower one matters more:
  -- without it, `{}` or `{"recipes": []}` saves nothing, falls through
  -- to the stamp at the bottom, and permanently locks that household out
  -- of the starter recipes while reporting (true, 0) -- a one-shot burnt
  -- by a client bug (Codex, PR #144).
  if jsonb_array_length(coalesce(payload->'recipes', '[]'::jsonb)) = 0 then
    raise exception 'starter recipe payload is empty' using errcode = 'P0001';
  end if;

  if jsonb_array_length(coalesce(payload->'recipes', '[]'::jsonb)) > 20 then
    raise exception 'starter recipe payload too large' using errcode = 'P0001';
  end if;

  -- Lock first, read second -- the discipline 20260827120000 retrofitted
  -- onto the weekly-plan family. Two members tapping at the same moment
  -- serialise here: one seeds, one gets (false, 0).
  select h.starter_recipes_seeded_at into existing_stamp
  from public.households h
  where h.id = caller_household_id
  for update;

  if existing_stamp is not null then
    return query select false, 0;
    return;
  end if;

  -- The invariant, not the proxy. The client's "the library is empty" is
  -- a local-mirror read taken before the first sync settles, so a
  -- reinstalled device on an established household genuinely believes it
  -- is empty. A stamp-only guard would happily add ten starters to a
  -- fifty-recipe library and then stamp it, with no second chance to get
  -- it right. Deliberately counts archived and deleted rows too: a
  -- household with recipe history is not a new library, whatever its
  -- Library screen currently shows.
  if exists (select 1 from public.recipes where household_id = caller_household_id) then
    return query select false, 0;
    return;
  end if;

  -- save_recipe's create branch normally clears the caller's unsaved
  -- new-recipe draft. This is the one caller for which that is wrong, so
  -- it opts out via preserveNewRecipeDraft below rather than deleting and
  -- restoring around the loop -- see this migration's header for why the
  -- capture-and-reinsert approach was abandoned.

  for recipe_row in
    select value as recipe
    from jsonb_array_elements(coalesce(payload->'recipes', '[]'::jsonb))
  loop
    -- Categories resolve by (group_name, value), never by id: category
    -- ids are gen_random_uuid() defaults seeded per environment
    -- (20260803100000), so a hardcoded id passes every local test and
    -- attaches nothing on staging. An unresolvable pair is skipped, not
    -- raised -- a renamed category should cost one chip, not ten
    -- recipes. The client-side test is what stops that going unnoticed.
    select coalesce(jsonb_agg(c.id), '[]'::jsonb)
    into resolved_category_ids
    from jsonb_array_elements(coalesce(recipe_row.recipe->'categories', '[]'::jsonb)) as ref
    join public.categories c
      on c.group_name = ref.value->>'group'
     and c.value = ref.value->>'value';

    -- Nested security definer shares this transaction (ADR-0020's
    -- finalize_import_job pattern), so the ten saves are genuinely
    -- all-or-nothing and versioning/snapshot behaviour is identical to a
    -- user-created recipe.
    --
    -- Built field by field rather than passed through. save_recipe
    -- branches to its UPDATE path on payload->>'id', so a forwarded
    -- payload would let a caller aim this at an existing recipe. That is
    -- already unreachable -- the emptiness guard above means there is no
    -- recipe in this household to match, and save_recipe's lookup is
    -- household-scoped anyway -- but relying on a second-order argument
    -- for a write boundary is exactly what AGENTS.md's review priority 1
    -- asks not to do. An allowlist also keeps id, baseVersion,
    -- heroImagePath, originalPhotoPath and sourceUrl out of the
    -- recipe_versions snapshot save_recipe stores verbatim.
    --
    -- sourceUrl is omitted deliberately, not forgotten: a starter recipe
    -- has no real URL, and a fake one would collide with the
    -- (household_id, source_url) partial unique index (20260805120100)
    -- and render as a live link.
    perform public.save_recipe(jsonb_build_object(
      'preserveNewRecipeDraft', true,
      'title', recipe_row.recipe->>'title',
      'activeTimeMinutes', recipe_row.recipe->'activeTimeMinutes',
      'totalTimeMinutes', recipe_row.recipe->'totalTimeMinutes',
      'yieldText', recipe_row.recipe->>'yieldText',
      'servingsCount', recipe_row.recipe->'servingsCount',
      'permanentNotes', recipe_row.recipe->>'permanentNotes',
      'sourceAttribution', recipe_row.recipe->>'sourceAttribution',
      'tags', coalesce(recipe_row.recipe->'tags', '[]'::jsonb),
      'categoryIds', resolved_category_ids,
      'ingredientSections', coalesce(recipe_row.recipe->'ingredientSections', '[]'::jsonb),
      'instructionSections', coalesce(recipe_row.recipe->'instructionSections', '[]'::jsonb)
    ));
    saved_count := saved_count + 1;
  end loop;

  update public.households
  set starter_recipes_seeded_at = now()
  where id = caller_household_id;

  return query select true, saved_count;
end;
$$;


-- save_recipe gains one opt-in flag: preserveNewRecipeDraft.
--
-- Its create branch ends by deleting the caller's unsaved new-recipe
-- draft, which is right for every existing caller -- the create it just
-- performed WAS that draft. It is wrong for seed_starter_recipes, which
-- performs ten creates the user did not author.
--
-- The first attempt at this kept save_recipe untouched and had the seed
-- capture the draft under `select ... for update` and reinsert it after
-- the loop. Codex rejected that on PR #144 and was right: a blocked
-- concurrent upsert_draft does not rescan after the delete, so it falls
-- through to its own INSERT, collides with the partial unique index, and
-- RecipeEditorScreen swallows the failed autosave silently. It also
-- could not cover a draft created mid-loop, since `for update` can only
-- lock a row that already exists.
--
-- Not deleting at all closes both. The body below is byte-identical to
-- 20260805140100's apart from the guarded delete and keeping the flag
-- out of the version snapshot -- no signature change, so every existing
-- caller and PostgREST resolution is untouched.

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
    -- The flag is a call-site instruction, not recipe data; it must not
    -- land in the stored version snapshot.
    (payload - 'preserveNewRecipeDraft') || jsonb_build_object('id', target_recipe_id),
    auth.uid()
  );

  if is_create then
    -- Normally the create just performed WAS the caller's new-recipe
    -- draft, so clearing it is right. seed_starter_recipes is the one
    -- caller for which that is false: it performs ten creates the user
    -- did not author, and would otherwise destroy a genuine in-progress
    -- draft. Nothing else sets this flag, and its absence means the old
    -- behaviour exactly.
    if not coalesce((payload->>'preserveNewRecipeDraft')::boolean, false) then
      delete from public.recipe_drafts
      where user_id = auth.uid() and household_id = caller_household_id and recipe_id is null;
    end if;
  else
    delete from public.recipe_drafts
    where user_id = auth.uid() and recipe_id = target_recipe_id;
  end if;

  return result_recipe;
end;
$$;

revoke all on function public.seed_starter_recipes(jsonb) from public;
grant execute on function public.seed_starter_recipes(jsonb) to authenticated;

revoke all on function public.save_recipe(jsonb) from public;
grant execute on function public.save_recipe(jsonb) to authenticated;
