-- ADR-0027 addendum (decision 2b): append_selection_round_candidates —
-- adds freshly scored candidates to an *active* round's existing deck,
-- on top of picks already made, without discarding anything. This is a
-- separate, simpler mechanism from the documented refill_selection_round
-- (`docs/proposals/smart-meal-selection-architecture.md` decision 2a),
-- which is scoped to the group flow's post-close results screen and
-- exists specifically to interact with the reveal freeze (`revealed_at`)
-- once ballots are readable. A round still `active` has never revealed
-- anything to anyone regardless of mode, so there is no privacy boundary
-- to protect here — the guard is `status = 'active'`, not `mode = 'solo'`.
--
-- No claim_token (nothing to fence — this isn't the two-commit creation
-- race decision 1a protects against) and no strategy_version param
-- (appending reuses the round's existing strategy; overwriting
-- candidate_strategy_version would misleadingly suggest the whole round
-- was rescored).
create or replace function public.append_selection_round_candidates(
  round_id uuid,
  candidates jsonb
)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  locked_round public.selection_rounds;
  result_round public.selection_rounds;
  candidate_count integer;
  current_max_position integer;
begin
  perform public.resolve_selection_round_deadline(append_selection_round_candidates.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into locked_round
  from public.selection_rounds
  where id = append_selection_round_candidates.round_id
    and household_id = caller_household_id
  for update;

  if locked_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  -- The one status guard this needs: `active` means nothing has been
  -- revealed yet regardless of solo/group, so this is safe for both
  -- without touching revealed_at or the reveal freeze (decision 2a) at
  -- all.
  if locked_round.status <> 'active' then
    raise exception 'selection round is not active' using errcode = 'P0001';
  end if;

  candidate_count := coalesce(jsonb_array_length(append_selection_round_candidates.candidates), 0);
  if candidate_count = 0 then
    raise exception 'candidates must not be empty' using errcode = 'P0001';
  end if;

  -- Re-derive and validate every recipe_id server-side (ADR-0027 decision
  -- 5's re-derive-never-trust rule) — identical block to
  -- finalize_selection_round_candidates.
  if exists (
    select 1
    from jsonb_array_elements(append_selection_round_candidates.candidates) as c
    where not exists (
      select 1 from public.recipes r
      where r.id = (c ->> 'recipe_id')::uuid
        and r.household_id = caller_household_id
        and r.archived_at is null
        and r.deleted_at is null
    )
  ) then
    raise exception 'candidate recipe not found or not eligible' using errcode = 'P0001';
  end if;

  -- Defense-in-depth on top of the unique(round_id, recipe_id) DB
  -- constraint, which stays as the hard backstop.
  if exists (
    select 1
    from jsonb_array_elements(append_selection_round_candidates.candidates) as c
    where exists (
      select 1 from public.selection_round_candidates existing
      where existing.round_id = append_selection_round_candidates.round_id
        and existing.recipe_id = (c ->> 'recipe_id')::uuid
    )
  ) then
    raise exception 'candidate recipe is already a candidate of this round' using errcode = 'P0001';
  end if;

  select coalesce(max(position), -1) into current_max_position
  from public.selection_round_candidates
  where selection_round_candidates.round_id = append_selection_round_candidates.round_id;

  -- with ordinality starts ord at 1, so the first appended row lands at
  -- current_max_position + 1, continuing finalize_selection_round_
  -- candidates's zero-based sequence.
  insert into public.selection_round_candidates (round_id, household_id, recipe_id, score, reason_codes, position)
  select
    append_selection_round_candidates.round_id,
    caller_household_id,
    (c ->> 'recipe_id')::uuid,
    (c ->> 'score')::numeric,
    coalesce(array(select jsonb_array_elements_text(c -> 'reason_codes')), '{}'),
    current_max_position + ord
  from jsonb_array_elements(append_selection_round_candidates.candidates)
    with ordinality as t(c, ord);

  update public.selection_rounds
  set updated_at = now()
  where id = append_selection_round_candidates.round_id
  returning * into result_round;

  return result_round;
end;
$$;

revoke all on function public.append_selection_round_candidates(uuid, jsonb) from public;
grant execute on function public.append_selection_round_candidates(uuid, jsonb) to authenticated;
