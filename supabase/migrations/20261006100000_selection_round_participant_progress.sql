-- get_selection_round: each participant now carries display_name,
-- decided_count and yes_count, for the group waiting screen (#239).
-- Counts are visible to the whole household mid-round by decision
-- (ADR-0027, 2026-10-06 amendment); which recipe someone chose still
-- waits for close. Additive keys only, so older clients ignore them.
--
-- Counts cover only decisions on the deck this call returns, so
-- "n of the deck" never exceeds the deck a participant is shown.
create or replace function public.get_selection_round(round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_round public.selection_rounds;
  participants_json jsonb;
  candidates_json jsonb;
begin
  perform public.resolve_selection_round_deadline(get_selection_round.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into result_round
  from public.selection_rounds
  where id = get_selection_round.round_id
    and household_id = caller_household_id;

  if result_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  -- One statement, so the deck and the counts share a snapshot: as two
  -- statements, a recipe archived between them could be counted in
  -- progress yet missing from the deck (Codex, PR #246). Progress joins
  -- the same deck rows, so it can never exceed them.
  with deck as (
    select c.recipe_id, c.score, c.reason_codes, c.position
    from public.selection_round_candidates c
    join public.recipes r on r.id = c.recipe_id
    where c.round_id = result_round.id
      and r.archived_at is null
      and r.deleted_at is null
  ),
  progress as (
    select
      d.user_id,
      count(*) as decided_count,
      count(*) filter (where d.decision = 'yes') as yes_count
    from public.selection_decisions d
    join deck on deck.recipe_id = d.recipe_id
    where d.round_id = result_round.id
    group by d.user_id
  )
  select
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'completed_at', p.completed_at,
        'display_name', pr.display_name,
        'decided_count', coalesce(pg.decided_count, 0),
        'yes_count', coalesce(pg.yes_count, 0)
      ) order by p.created_at, pr.display_name, p.user_id), '[]'::jsonb)
      from public.selection_round_participants p
      left join public.profiles pr on pr.id = p.user_id
      left join progress pg on pg.user_id = p.user_id
      where p.round_id = result_round.id
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'recipe_id', deck.recipe_id,
        'score', deck.score,
        'reason_codes', deck.reason_codes,
        'position', deck.position
      ) order by deck.position), '[]'::jsonb)
      from deck
    )
  into participants_json, candidates_json;

  return (to_jsonb(result_round) - 'claim_token')
    || jsonb_build_object('participants', participants_json, 'candidates', candidates_json);
end;
$$;

revoke all on function public.get_selection_round(uuid) from public;
revoke all on function public.get_selection_round(uuid) from anon;
grant execute on function public.get_selection_round(uuid) to authenticated;
