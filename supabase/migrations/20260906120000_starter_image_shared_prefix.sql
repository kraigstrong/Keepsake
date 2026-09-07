-- ADR-0029. The ten starter images live once, at "starters/<key>.jpg" in
-- recipe-images, instead of being copied into every household that seeds.
-- That is what makes them replaceable: every seeded recipe points at the
-- same object, so swapping it upgrades every household retroactively --
-- which is the objection docs/proposals/starter-recipes.md §4 raised
-- against shipping any image at all.
--
-- This is the first object in this bucket not scoped by household, so it
-- is a deliberate widening of what an authenticated user may read. What
-- it exposes is ten identical shipped assets, not anyone's data, and the
-- bucket stays private -- reads still go through short-lived signed URLs.

create policy "Anyone signed in can read the shared starter images"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recipe-images'
    -- Matched against the exact shape starter_image_path can produce,
    -- not the whole prefix. Granting the prefix would make anything ever
    -- placed under it world-readable to every signed-in user, including
    -- something put there by an operator slip -- a stray backup, a
    -- notes file. This way the readable set is exactly the set the app
    -- can actually reference.
    and name ~ '^starters/[a-z0-9-]{1,64}\.jpg$'
  );

-- No write policy, deliberately, and none is needed to keep this prefix
-- read-only. The bucket's existing insert/update/delete policies
-- (20260802120800) all require
-- is_household_member(safe_uuid((storage.foldername(name))[1])), and
-- safe_uuid('starters') is null because 'starters' is not a uuid, so each
-- of them evaluates to false here. The prefix is therefore read-only by
-- construction rather than by convention: there is no policy an
-- authenticated caller could satisfy to write, overwrite or delete an
-- object under it. Objects are placed out of band with the service role
-- (docs/deploying-starter-images.md).
--
-- Nor can a household ever collide with it: household ids are uuids, and
-- 'starters' is not one.

-- The seed RPC gains an image key, not a path. It already builds its
-- save_recipe payload as an allowlist that deliberately keeps
-- heroImagePath out (20260901100000) -- forwarding a client-supplied path
-- would widen exactly the boundary that allowlist exists to hold. A key
-- validated against a strict pattern and expanded here keeps it closed:
-- a caller cannot aim hero_image_path anywhere but the shared prefix.
create or replace function public.starter_image_path(image_key text)
returns text
language sql
immutable
as $$
  select case
    when image_key is null then null
    -- Anchored, and bounded. Rejects path separators, "..", uppercase and
    -- anything else that could escape the prefix or resolve oddly.
    when image_key ~ '^[a-z0-9-]{1,64}$' then 'starters/' || image_key || '.jpg'
    else null
  end;
$$;

-- Matching the convention every other function here follows: nothing is
-- executable by `public` by default.
revoke all on function public.starter_image_path(text) from public;
grant execute on function public.starter_image_path(text) to authenticated;

comment on function public.starter_image_path(text) is
  'ADR-0029. Expands a starter recipe''s image key to its shared-prefix Storage
   path. Returns null for an absent or malformed key rather than raising: a bad
   key should cost one photo, not ten recipes, and every surface already renders
   ImagePlaceholder for a null hero_image_path.';


-- Byte-identical to 20260901100000's definition apart from the one field
-- added to the allowlist below, and the comment above it that named
-- heroImagePath as deliberately excluded. No signature change, so every
-- existing caller and PostgREST resolution is untouched.
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
    -- originalPhotoPath and sourceUrl out of the recipe_versions
    -- snapshot save_recipe stores verbatim.
    --
    -- heroImagePath was on that list until ADR-0029 and is now set
    -- below, which does not weaken the argument above: what the client
    -- supplies is a key, not a path, and starter_image_path expands it
    -- here. It belongs in the snapshot for the same reason it does for
    -- a user's own recipe -- restoring an old version should restore
    -- the image it had.
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
      'instructionSections', coalesce(recipe_row.recipe->'instructionSections', '[]'::jsonb),
      -- ADR-0029. The one field added to the allowlist since it was
      -- written, and added as a *key* rather than a path for the reason
      -- the allowlist exists: starter_image_path expands it here, so a
      -- caller cannot aim hero_image_path outside 'starters/'. A
      -- malformed or absent key yields null, which every surface already
      -- renders as ImagePlaceholder.
      'heroImagePath', public.starter_image_path(recipe_row.recipe->>'imageKey')
    ));
    saved_count := saved_count + 1;
  end loop;

  -- The guard above is fenced, not racy, and the fence is the foreign
  -- key: every insert into recipes takes `for key share` on its
  -- households row to validate recipes_household_id_fkey, which
  -- conflicts with the `for update` taken at the top. So a create in
  -- flight blocks this function before it reads, and a create starting
  -- after it blocks until it commits. Verified with two live sessions,
  -- both directions -- see docs/proposals/starter-recipes.md §2.

  update public.households
  set starter_recipes_seeded_at = now()
  where id = caller_household_id;

  return query select true, saved_count;
end;
$$;
