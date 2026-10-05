-- #231: explicit meal classification independent of dish/protein categories.
-- Approved starting rule: Dessert => non-meal; all other existing recipes => meal.
alter table public.recipes add column is_meal boolean not null default true;
update public.recipes r set is_meal = false, updated_at = now()
where exists (
  select 1 from public.recipe_categories rc join public.categories c on c.id = rc.category_id
  where rc.recipe_id = r.id and c.group_name = 'dish_type' and c.value = 'Dessert'
);
-- Keep historical restores faithful to the same starting classification.
update public.recipe_versions v set snapshot = snapshot || jsonb_build_object('isMeal', not exists (
  select 1 from public.categories c
  where c.group_name = 'dish_type' and c.value = 'Dessert'
    and c.id in (select value::uuid from jsonb_array_elements_text(coalesce(v.snapshot->'categoryIds', '[]'::jsonb)))
));

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
  effective_is_meal boolean;
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

  if payload ? 'isMeal' and jsonb_typeof(payload->'isMeal') <> 'boolean' then
    raise exception 'isMeal must be a boolean' using errcode = 'P0001';
  end if;
  if is_create then
    -- Older import/starter clients omit the field: apply the agreed
    -- initial classification from structured Dessert membership only.
    effective_is_meal := coalesce((payload->>'isMeal')::boolean, not exists (
      select 1 from public.categories c
      where c.group_name = 'dish_type' and c.value = 'Dessert'
        and c.id in (select value::uuid from jsonb_array_elements_text(coalesce(payload->'categoryIds', '[]'::jsonb)))
    ));
    insert into public.recipes (
      household_id, title, hero_image_path, original_photo_path, active_time_minutes,
      total_time_minutes, yield_text, servings_count, permanent_notes, source_url,
      source_attribution, tags, created_by, is_meal
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
      auth.uid(),
      effective_is_meal
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
      is_meal = coalesce((payload->>'isMeal')::boolean, is_meal),
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
    (payload - 'preserveNewRecipeDraft') || jsonb_build_object('id', target_recipe_id, 'isMeal', result_recipe.is_meal),
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

revoke all on function public.save_recipe(jsonb) from public;
grant execute on function public.save_recipe(jsonb) to authenticated;

-- Round-scoped, immutable once candidates are finalized. Refill reads this
-- stored value, never a changing device preference.
alter table public.selection_rounds add column meals_only boolean not null default false;

create or replace function public.create_selection_round_with_filters(
  mode text,
  participant_user_ids uuid[] default '{}',
  target_count integer default null,
  closes_at timestamptz default null,
  meals_only boolean default false
)
returns table (round_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- "Short staleness window" (decision 1a) — scoring takes seconds, so
  -- a pending round older than this is presumed abandoned and can be
  -- taken over by a different creator rather than blocking the
  -- household forever.
  pending_stale_after constant interval := interval '2 minutes';
  caller_household_id uuid;
  existing_round public.selection_rounds;
  result_round public.selection_rounds;
  final_participants uuid[];
  effective_closes_at timestamptz;
begin
  if create_selection_round_with_filters.mode not in ('solo', 'group') then
    raise exception 'invalid mode' using errcode = 'P0001';
  end if;

  if meals_only is null then
    raise exception 'meals_only must be a boolean' using errcode = 'P0001';
  end if;

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  -- Solo ignores both group-only inputs (ADR-0027, "Solo mode ignores
  -- participant_user_ids ... and takes no closes_at") — a smuggled
  -- cross-household id in an ignored array is simply never looked at,
  -- distinct from the group-mode validation below where it must be
  -- rejected, not silently dropped.
  if create_selection_round_with_filters.mode = 'solo' then
    final_participants := array[auth.uid()];
    effective_closes_at := null;
  else
    -- A group round must carry a real future deadline (decision 3).
    -- Early close is creator-only, so closes_at is the only thing that
    -- lets the other participants reach review if the creator goes
    -- quiet — without it their sole option is to cancel and lose the
    -- round. This is the same reason refill is required to set a new
    -- one rather than clear it.
    if create_selection_round_with_filters.closes_at is null
       or create_selection_round_with_filters.closes_at <= now() then
      raise exception 'a group round requires a future closes_at' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from unnest(create_selection_round_with_filters.participant_user_ids) as pid
      where not exists (
        select 1 from public.household_membership hm
        where hm.user_id = pid and hm.household_id = caller_household_id
      )
    ) then
      raise exception 'participant is not a member of the caller''s household' using errcode = 'P0001';
    end if;

    select array_agg(distinct uid) into final_participants
    from unnest(array_append(create_selection_round_with_filters.participant_user_ids, auth.uid())) as uid;

    effective_closes_at := create_selection_round_with_filters.closes_at;
  end if;

  select * into existing_round
  from public.selection_rounds
  where household_id = caller_household_id
    and status in ('pending_candidates', 'active', 'ready_for_review')
  for update;

  if existing_round.id is not null then
    -- Resolve first (decision 4): a discovered round is round-scoped
    -- state this RPC reads, so it goes through the same helper as
    -- every other entry point before this function decides anything
    -- from its status.
    perform public.resolve_selection_round_deadline(existing_round.id);
    select * into existing_round from public.selection_rounds where id = existing_round.id;

    if existing_round.status in ('active', 'ready_for_review') then
      raise exception 'a selection round is already in progress for this household' using errcode = 'P0001';
    end if;

    -- existing_round.status = 'pending_candidates' here. Adoption
    -- (decision 1a): same creator resumes, or a different creator
    -- takes over once the round is older than the staleness window —
    -- either way a fresh claim_token invalidates whatever attempt was
    -- in flight against the old one. A different, still-fresh creator
    -- is the one case that's a real conflict.
    -- Staleness is measured from updated_at, not created_at: renewing a
    -- claim below bumps updated_at, and measuring from created_at would
    -- leave a just-renewed attempt still looking stale — letting another
    -- member take it over and invalidate the fresh token while scoring
    -- is in flight.
    if existing_round.created_by <> auth.uid()
       and existing_round.updated_at >= now() - pending_stale_after then
      raise exception 'a round is already starting' using errcode = 'P0001';
    end if;

    update public.selection_rounds
    set created_by = auth.uid(),
        mode = create_selection_round_with_filters.mode,
        meals_only = create_selection_round_with_filters.meals_only,
        target_count = create_selection_round_with_filters.target_count,
        closes_at = effective_closes_at,
        claim_token = gen_random_uuid(),
        updated_at = now()
    where id = existing_round.id
    returning * into result_round;

    delete from public.selection_round_participants
    where selection_round_participants.round_id = result_round.id;
  else
    insert into public.selection_rounds (
      household_id, created_by, mode, target_count, closes_at, claim_token, meals_only
    ) values (
      caller_household_id, auth.uid(), create_selection_round_with_filters.mode,
      create_selection_round_with_filters.target_count, effective_closes_at, gen_random_uuid(), create_selection_round_with_filters.meals_only
    )
    returning * into result_round;
  end if;

  insert into public.selection_round_participants (round_id, household_id, user_id)
  select result_round.id, caller_household_id, uid
  from unnest(final_participants) as uid;

  round_id := result_round.id;
  claim_token := result_round.claim_token;
  return next;
end;
$$;

revoke all on function public.create_selection_round_with_filters(text, uuid[], integer, timestamptz, boolean) from public;
grant execute on function public.create_selection_round_with_filters(text, uuid[], integer, timestamptz, boolean) to authenticated;

-- Keep the existing RPC signature for older apps and SQL callers. Both
-- entry points share exactly the same claim/lease/household transaction.
create or replace function public.create_selection_round(
  mode text,
  participant_user_ids uuid[] default '{}',
  target_count integer default null,
  closes_at timestamptz default null
)
returns table (round_id uuid, claim_token uuid)
language sql
security definer
set search_path = public
as $$
  select * from public.create_selection_round_with_filters(mode, participant_user_ids, target_count, closes_at, false);
$$;
revoke all on function public.create_selection_round(text, uuid[], integer, timestamptz) from public;
grant execute on function public.create_selection_round(text, uuid[], integer, timestamptz) to authenticated;
