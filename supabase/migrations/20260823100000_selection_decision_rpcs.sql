-- Milestone 4 (ADR-0027): decision-recording, close, and results RPCs —
-- record_selection_decision, clear_selection_decision,
-- finish_selection_participation, close_selection_round,
-- get_selection_round_results. Builds on the round lifecycle RPCs
-- (20260821100000) and calls the same resolve_selection_round_deadline
-- helper. All five are SECURITY DEFINER, set search_path = public, and
-- re-derive the caller's household via my_household_id() — never a
-- client-supplied household_id (ADR-0008), same shape as
-- selection_round_lifecycle_rpcs.sql.

-- assert_selection_decision_writable: the guard set shared by
-- record_selection_decision and clear_selection_decision (round active,
-- caller is a participant, recipe_id is an actual candidate of this
-- round, candidate isn't frozen). Internal only, same reasoning as
-- resolve_selection_round_deadline — a SECURITY DEFINER function's
-- nested calls run as the owner, so no grant is needed and none should
-- be added (see 20260822100000 for why `revoke ... from public` alone
-- is insufficient on a real Supabase project).
create or replace function public.assert_selection_decision_writable(round_id uuid, recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_round public.selection_rounds;
  target_candidate public.selection_round_candidates;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into target_round
  from public.selection_rounds
  where id = assert_selection_decision_writable.round_id
    and household_id = caller_household_id;

  if target_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  if target_round.status <> 'active' then
    raise exception 'selection round is not active' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.selection_round_participants p
    where p.round_id = target_round.id and p.user_id = auth.uid()
  ) then
    raise exception 'caller is not a participant of this round' using errcode = 'P0001';
  end if;

  select * into target_candidate
  from public.selection_round_candidates c
  where c.round_id = target_round.id
    and c.recipe_id = assert_selection_decision_writable.recipe_id;

  if target_candidate.id is null then
    raise exception 'recipe is not a candidate of this round' using errcode = 'P0001';
  end if;

  -- ADR-0027 decision 2a: a candidate that existed at or before the
  -- round's first reveal is frozen. Without this, a refill's trip back
  -- to active would let a participant change an already-revealed vote
  -- having just read everyone else's ballots — the entire privacy
  -- guarantee decision 2 establishes. Candidates a refill adds are
  -- created after revealed_at, so they stay writable.
  if target_round.revealed_at is not null
     and target_candidate.created_at <= target_round.revealed_at then
    raise exception 'candidate decision is frozen after reveal' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assert_selection_decision_writable(uuid, uuid) from public;
revoke all on function public.assert_selection_decision_writable(uuid, uuid) from anon;
revoke all on function public.assert_selection_decision_writable(uuid, uuid) from authenticated;

-- record_selection_decision: upsert on (round_id, recipe_id, user_id),
-- so a client retry after a dropped response replays cleanly instead of
-- erroring or duplicating.
create or replace function public.record_selection_decision(round_id uuid, recipe_id uuid, decision text)
returns public.selection_decisions
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_decision public.selection_decisions;
begin
  perform public.resolve_selection_round_deadline(record_selection_decision.round_id);
  perform public.assert_selection_decision_writable(
    record_selection_decision.round_id, record_selection_decision.recipe_id
  );

  caller_household_id := public.my_household_id();

  insert into public.selection_decisions (round_id, household_id, recipe_id, user_id, decision)
  values (
    record_selection_decision.round_id, caller_household_id, record_selection_decision.recipe_id,
    auth.uid(), record_selection_decision.decision
  )
  -- Named by constraint, not column list: an unqualified (round_id,
  -- recipe_id, user_id) target is ambiguous here against this
  -- function's own parameters of the same names.
  on conflict on constraint selection_decisions_round_id_recipe_id_user_id_key
  do update set decision = excluded.decision, updated_at = now()
  returning * into result_decision;

  return result_decision;
end;
$$;

revoke all on function public.record_selection_decision(uuid, uuid, text) from public;
grant execute on function public.record_selection_decision(uuid, uuid, text) to authenticated;

-- clear_selection_decision: deletes the caller's own row, reverting to
-- unseen (ADR-0027 decision 1 — absence is the third vote state, not a
-- stored value). Same guard set as recording, including the frozen-
-- candidate rule: undoing a revealed vote is still changing it.
create or replace function public.clear_selection_decision(round_id uuid, recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.resolve_selection_round_deadline(clear_selection_decision.round_id);
  perform public.assert_selection_decision_writable(
    clear_selection_decision.round_id, clear_selection_decision.recipe_id
  );

  -- Aliased and qualified throughout: bare round_id/recipe_id would be
  -- ambiguous against this function's own parameters of the same names.
  delete from public.selection_decisions sd
  where sd.round_id = clear_selection_decision.round_id
    and sd.recipe_id = clear_selection_decision.recipe_id
    and sd.user_id = auth.uid();
end;
$$;

revoke all on function public.clear_selection_decision(uuid, uuid) from public;
grant execute on function public.clear_selection_decision(uuid, uuid) to authenticated;

-- finish_selection_participation: sets the caller's completed_at once,
-- idempotent thereafter. Deliberately does not lock the ballot — a
-- completed participant may still record/clear decisions while the
-- round is active, because results are computed live at read time. Must
-- still require 'active': a late completion after the deadline would
-- move the completed-participant denominator on an already-frozen round
-- (ADR-0027 decision 4).
create or replace function public.finish_selection_participation(round_id uuid)
returns public.selection_round_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_round public.selection_rounds;
  result_participant public.selection_round_participants;
begin
  perform public.resolve_selection_round_deadline(finish_selection_participation.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into target_round
  from public.selection_rounds
  where id = finish_selection_participation.round_id
    and household_id = caller_household_id;

  if target_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  if target_round.status <> 'active' then
    raise exception 'selection round is not active' using errcode = 'P0001';
  end if;

  -- Aliased and qualified: bare round_id would be ambiguous against this
  -- function's own round_id parameter.
  update public.selection_round_participants sp
  set completed_at = coalesce(sp.completed_at, now())
  where sp.round_id = target_round.id and sp.user_id = auth.uid()
  returning sp.* into result_participant;

  if result_participant.id is null then
    raise exception 'caller is not a participant of this round' using errcode = 'P0001';
  end if;

  return result_participant;
end;
$$;

revoke all on function public.finish_selection_participation(uuid) from public;
grant execute on function public.finish_selection_participation(uuid) to authenticated;

-- close_selection_round: active -> ready_for_review, creator-only
-- (ADR-0027 decision 3 — deliberately unlike cancel, which any member
-- may do). The creator check runs before the atomic update rather than
-- inside its WHERE clause so a non-creator gets a distinct error from a
-- non-active round; created_by cannot change once a round is active
-- (only the pending_candidates adoption path in create_selection_round
-- reassigns it), so there is no race between the two steps.
create or replace function public.close_selection_round(round_id uuid)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_round public.selection_rounds;
  result_round public.selection_rounds;
begin
  perform public.resolve_selection_round_deadline(close_selection_round.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into target_round
  from public.selection_rounds
  where id = close_selection_round.round_id
    and household_id = caller_household_id;

  if target_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  if target_round.created_by <> auth.uid() then
    raise exception 'only the round creator may close it' using errcode = 'P0001';
  end if;

  -- Atomic status-guarded UPDATE ... RETURNING (same shape as
  -- finalize_selection_round_candidates/cancel_selection_round).
  -- coalesce(revealed_at, ...), not an overwrite: decision 2a freezes
  -- decisions as of the *first* reveal, so a second close after a
  -- future refill must never push revealed_at forward.
  update public.selection_rounds
  set status = 'ready_for_review',
      closed_at = now(),
      revealed_at = coalesce(revealed_at, now()),
      updated_at = now()
  where id = close_selection_round.round_id
    and household_id = caller_household_id
    and status = 'active'
  returning * into result_round;

  if result_round.id is null then
    raise exception 'selection round is not active' using errcode = 'P0001';
  end if;

  return result_round;
end;
$$;

revoke all on function public.close_selection_round(uuid) from public;
grant execute on function public.close_selection_round(uuid) to authenticated;

-- get_selection_round_results: read-only, consensus over completed
-- participants only. ADR-0027 decision 2: SECURITY DEFINER bypasses RLS
-- entirely, so this independently enforces the exact allowlist the
-- selection_decisions SELECT policy uses — status != 'active' also
-- admits 'cancelled', and cancelling is open to any member, which would
-- make cancel a ballot-disclosure path around the creator-only close
-- gate. yes_count only ever counts an explicit decision = 'yes' row, so
-- a completed participant who never reached a card contributes to the
-- denominator but is never listed as having chosen it or implied to
-- have passed.
create or replace function public.get_selection_round_results(round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  target_round public.selection_rounds;
  completed_count integer;
  candidates_json jsonb;
begin
  perform public.resolve_selection_round_deadline(get_selection_round_results.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into target_round
  from public.selection_rounds
  where id = get_selection_round_results.round_id
    and household_id = caller_household_id;

  if target_round.id is null then
    raise exception 'selection round not found' using errcode = 'P0001';
  end if;

  if target_round.status not in ('ready_for_review', 'applied') then
    raise exception 'selection round results are not available yet' using errcode = 'P0001';
  end if;

  select count(*) into completed_count
  from public.selection_round_participants p
  where p.round_id = target_round.id and p.completed_at is not null;

  -- Same live archived/deleted recheck as get_selection_round (ADR-0027
  -- decision 1: a candidate row is never mutated, availability is
  -- checked at read time instead).
  select coalesce(jsonb_agg(jsonb_build_object(
    'recipe_id', c.recipe_id,
    'yes_count', coalesce(y.yes_count, 0),
    'completed_participant_count', completed_count,
    'category', case
      when completed_count = 0 then 'mixed'
      when coalesce(y.yes_count, 0) = completed_count then 'unanimous'
      when coalesce(y.yes_count, 0) * 2 > completed_count then 'majority'
      else 'mixed'
    end,
    'chosen_by', coalesce(y.chosen_by, '[]'::jsonb)
  ) order by c.position), '[]'::jsonb)
  into candidates_json
  from public.selection_round_candidates c
  join public.recipes r on r.id = c.recipe_id
  left join lateral (
    select
      count(*) as yes_count,
      jsonb_agg(jsonb_build_object('user_id', d.user_id, 'display_name', pr.display_name)
                order by pr.display_name) as chosen_by
    from public.selection_decisions d
    join public.selection_round_participants p
      on p.round_id = d.round_id and p.user_id = d.user_id
    join public.profiles pr on pr.id = d.user_id
    where d.round_id = c.round_id
      and d.recipe_id = c.recipe_id
      and d.decision = 'yes'
      and p.completed_at is not null
  ) y on true
  where c.round_id = target_round.id
    and r.archived_at is null
    and r.deleted_at is null;

  return jsonb_build_object(
    'round_id', target_round.id,
    'status', target_round.status,
    'completed_participant_count', completed_count,
    'candidates', candidates_json
  );
end;
$$;

revoke all on function public.get_selection_round_results(uuid) from public;
grant execute on function public.get_selection_round_results(uuid) to authenticated;
