-- get_selection_round: each participant now carries display_name,
-- decided_count and yes_count, for the group waiting screen (#239).
-- Counts are visible to the whole household mid-round by decision
-- (ADR-0027, 2026-10-06 amendment); which recipe someone chose still
-- waits for close. Additive keys only, so older clients ignore them.
--
-- Counts cover only the decisions on still-available candidates — the
-- same filter as the candidates array — so "n of the deck" never
-- exceeds the deck a participant is shown.
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.user_id,
    'completed_at', p.completed_at,
    'display_name', pr.display_name,
    'decided_count', coalesce(progress.decided_count, 0),
    'yes_count', coalesce(progress.yes_count, 0)
  ) order by p.created_at, pr.display_name, p.user_id), '[]'::jsonb)
  into participants_json
  from public.selection_round_participants p
  left join public.profiles pr on pr.id = p.user_id
  left join lateral (
    select
      count(*) as decided_count,
      count(*) filter (where d.decision = 'yes') as yes_count
    from public.selection_decisions d
    join public.recipes r on r.id = d.recipe_id
    where d.round_id = p.round_id
      and d.user_id = p.user_id
      and r.archived_at is null
      and r.deleted_at is null
  ) progress on true
  where p.round_id = result_round.id;

  -- Ordered by position, never by whatever the planner yields: the
  -- scorer's round-robin order is the deck.
  select coalesce(jsonb_agg(jsonb_build_object(
    'recipe_id', c.recipe_id,
    'score', c.score,
    'reason_codes', c.reason_codes,
    'position', c.position
  ) order by c.position), '[]'::jsonb)
  into candidates_json
  from public.selection_round_candidates c
  join public.recipes r on r.id = c.recipe_id
  where c.round_id = result_round.id
    and r.archived_at is null
    and r.deleted_at is null;

  return (to_jsonb(result_round) - 'claim_token')
    || jsonb_build_object('participants', participants_json, 'candidates', candidates_json);
end;
$$;

revoke all on function public.get_selection_round(uuid) from public;
revoke all on function public.get_selection_round(uuid) from anon;
grant execute on function public.get_selection_round(uuid) to authenticated;
