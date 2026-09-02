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
  captured_draft public.recipe_drafts;
  had_draft boolean := false;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  -- Fail fast before doing any work. The stamp already limits this to
  -- once per household forever, so no cooldown or rolling window is
  -- warranted; this cap only stops a malformed call doing arbitrary
  -- work before the guards below reject it.
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

  -- save_recipe's create branch ends by deleting the caller's unsaved
  -- new-recipe draft, because normally the create it just performed WAS
  -- that draft. Ten nested calls would destroy a genuine in-progress one
  -- -- reachable: start a recipe, back out (autosave keeps the draft),
  -- return to a still-empty Library, tap the offer.
  --
  -- `for update` rather than a plain select: a bare read-then-write here
  -- is itself a lost-update race (Codex, PR #138). upsert_draft matches
  -- on the predicate (user_id, recipe_id is null), not on a row id, so
  -- a blocked autosave re-finds the reinserted row correctly.
  --
  -- Known residual, deliberately not papered over: this locks a row that
  -- exists. If the caller has NO draft at capture and another of their
  -- devices inserts one mid-loop, a later save_recipe deletes it and
  -- nothing restores it. Closing that needs save_recipe to not delete at
  -- all (proposal §2 option 2), which changes a shared code path every
  -- other caller uses. The window is a few hundred milliseconds against
  -- a debounced autosave on a second device; recorded rather than
  -- claimed closed, and the better shape if save_recipe is ever opened
  -- up for another reason.
  select * into captured_draft
  from public.recipe_drafts
  where user_id = auth.uid()
    and household_id = caller_household_id
    and recipe_id is null
  for update;
  had_draft := found;

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

  if had_draft then
    insert into public.recipe_drafts (id, recipe_id, user_id, household_id, draft_payload, updated_at)
    values (
      captured_draft.id,
      null,
      captured_draft.user_id,
      captured_draft.household_id,
      captured_draft.draft_payload,
      captured_draft.updated_at
    );
  end if;

  update public.households
  set starter_recipes_seeded_at = now()
  where id = caller_household_id;

  return query select true, saved_count;
end;
$$;

revoke all on function public.seed_starter_recipes(jsonb) from public;
grant execute on function public.seed_starter_recipes(jsonb) to authenticated;
