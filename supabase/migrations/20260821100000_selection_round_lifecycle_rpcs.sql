-- Milestone 4 (ADR-0027): the round lifecycle RPCs — create, finalize,
-- get, cancel — plus the internal auto-close helper every one of them
-- threads through first. Builds on the spine schema/RLS
-- (20260820100000/100100). No Edge Function, no client code (next PR).
-- All four client-facing RPCs are SECURITY DEFINER and re-derive the
-- caller's household via my_household_id() — never a client-supplied
-- household_id (ADR-0008), same shape as weekly_plan_rpcs.sql.

-- ADR-0027 decision 4: auto-close is centralized in one internal helper
-- that every RPC below calls first, before doing anything else — an
-- enumerated "the RPCs that check the deadline" list is wrong the first
-- time someone adds another RPC. Deliberately not granted to
-- authenticated: a SECURITY DEFINER function's nested calls run as the
-- function's owner, so the RPCs below can call this without any grant,
-- and no direct client call can reach it (do not add one — see
-- "resolve_selection_round_deadline: not directly callable" below).
create or replace function public.resolve_selection_round_deadline(round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.selection_rounds
  set status = 'ready_for_review',
      -- coalesce, not overwrite: decision 2a freezes decisions as of
      -- the *first* reveal, so a later refill (out of scope here)
      -- sending the round back to active must never push revealed_at
      -- forward and unfreeze an already-revealed candidate.
      revealed_at = coalesce(revealed_at, now()),
      closed_at = now()
  where id = resolve_selection_round_deadline.round_id
    and status = 'active'
    and closes_at < now();
end;
$$;

revoke all on function public.resolve_selection_round_deadline(uuid) from public;

-- create_selection_round: begins the two-commit creation path (decision
-- 1a). Born pending_candidates with a fresh claim_token; the Edge
-- Function scores in between, then finalize_selection_round_candidates
-- (below) performs pending_candidates -> active atomically.
create or replace function public.create_selection_round(
  mode text,
  participant_user_ids uuid[] default '{}',
  target_count integer default null,
  closes_at timestamptz default null
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
  if create_selection_round.mode not in ('solo', 'group') then
    raise exception 'invalid mode' using errcode = 'P0001';
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
  if create_selection_round.mode = 'solo' then
    final_participants := array[auth.uid()];
    effective_closes_at := null;
  else
    -- A group round must carry a real future deadline (decision 3).
    -- Early close is creator-only, so closes_at is the only thing that
    -- lets the other participants reach review if the creator goes
    -- quiet — without it their sole option is to cancel and lose the
    -- round. This is the same reason refill is required to set a new
    -- one rather than clear it.
    if create_selection_round.closes_at is null
       or create_selection_round.closes_at <= now() then
      raise exception 'a group round requires a future closes_at' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from unnest(create_selection_round.participant_user_ids) as pid
      where not exists (
        select 1 from public.household_membership hm
        where hm.user_id = pid and hm.household_id = caller_household_id
      )
    ) then
      raise exception 'participant is not a member of the caller''s household' using errcode = 'P0001';
    end if;

    select array_agg(distinct uid) into final_participants
    from unnest(array_append(create_selection_round.participant_user_ids, auth.uid())) as uid;

    effective_closes_at := create_selection_round.closes_at;
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
        mode = create_selection_round.mode,
        target_count = create_selection_round.target_count,
        closes_at = effective_closes_at,
        claim_token = gen_random_uuid(),
        updated_at = now()
    where id = existing_round.id
    returning * into result_round;

    delete from public.selection_round_participants
    where selection_round_participants.round_id = result_round.id;
  else
    insert into public.selection_rounds (
      household_id, created_by, mode, target_count, closes_at, claim_token
    ) values (
      caller_household_id, auth.uid(), create_selection_round.mode,
      create_selection_round.target_count, effective_closes_at, gen_random_uuid()
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

revoke all on function public.create_selection_round(text, uuid[], integer, timestamptz) from public;
grant execute on function public.create_selection_round(text, uuid[], integer, timestamptz) to authenticated;

-- finalize_selection_round_candidates: writes the deck and atomically
-- transitions pending_candidates -> active. Decision 5: the Edge
-- Function calls this with the caller's ordinary JWT, so it is not a
-- trust boundary — any authenticated client can invoke it directly with
-- a hand-written candidates array. Every recipe_id is therefore
-- re-derived and validated here exactly like save_recipe/add_to_weekly_
-- plan already do for their own ids, not merely checked against the
-- round/household.
create or replace function public.finalize_selection_round_candidates(
  round_id uuid,
  claim_token uuid,
  candidates jsonb,
  strategy_version text
)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_round public.selection_rounds;
  candidate_count integer;
begin
  perform public.resolve_selection_round_deadline(finalize_selection_round_candidates.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  -- An empty deck would activate the exact deckless round decision 1a
  -- says should never be observable — reject rather than write nothing.
  candidate_count := coalesce(jsonb_array_length(finalize_selection_round_candidates.candidates), 0);
  if candidate_count = 0 then
    raise exception 'candidates must not be empty' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(finalize_selection_round_candidates.candidates) as c
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

  -- Fenced exactly like finalize_import_job (ADR-0020): one atomic
  -- status-guarded UPDATE keyed on the supplied claim_token, so a
  -- superseded or delayed finalize attempt loses cleanly rather than
  -- activating a stale round.
  update public.selection_rounds
  set status = 'active',
      candidate_strategy_version = finalize_selection_round_candidates.strategy_version,
      updated_at = now()
  where id = finalize_selection_round_candidates.round_id
    and household_id = caller_household_id
    and status = 'pending_candidates'
    and selection_rounds.claim_token = finalize_selection_round_candidates.claim_token
  returning * into result_round;

  if result_round.id is null then
    raise exception 'selection round not found, already finalized, or claim no longer held' using errcode = 'P0001';
  end if;

  insert into public.selection_round_candidates (round_id, household_id, recipe_id, score, reason_codes)
  select
    result_round.id,
    caller_household_id,
    (c ->> 'recipe_id')::uuid,
    (c ->> 'score')::numeric,
    coalesce(array(select jsonb_array_elements_text(c -> 'reason_codes')), '{}')
  from jsonb_array_elements(finalize_selection_round_candidates.candidates) as c;

  return result_round;
end;
$$;

revoke all on function public.finalize_selection_round_candidates(uuid, uuid, jsonb, text) from public;
grant execute on function public.finalize_selection_round_candidates(uuid, uuid, jsonb, text) to authenticated;

-- get_selection_round: round + participants + deck in one call. A
-- since-archived or since-deleted candidate recipe is filtered live
-- rather than tracked on the candidate row (decision 1: "never mutated
-- once written"). A cross-household round_id reads as not-found,
-- matching every other cross-household id lookup in this codebase.
-- claim_token is stripped from the returned round — it's an internal
-- fencing value for finalize, not something the client needs to read.
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
    'completed_at', p.completed_at
  )), '[]'::jsonb)
  into participants_json
  from public.selection_round_participants p
  where p.round_id = result_round.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'recipe_id', c.recipe_id,
    'score', c.score,
    'reason_codes', c.reason_codes
  )), '[]'::jsonb)
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
grant execute on function public.get_selection_round(uuid) to authenticated;

-- cancel_selection_round: status-guarded transition to cancelled, open
-- to any household member (decision 3 — unlike closing, cancelling
-- isn't creator-only). Terminal rounds (applied/already-cancelled)
-- aren't cancellable, hence the explicit status list rather than just
-- excluding 'cancelled'.
create or replace function public.cancel_selection_round(round_id uuid)
returns public.selection_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_round public.selection_rounds;
begin
  perform public.resolve_selection_round_deadline(cancel_selection_round.round_id);

  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.selection_rounds
  set status = 'cancelled', closed_at = now(), updated_at = now()
  where id = cancel_selection_round.round_id
    and household_id = caller_household_id
    and status in ('pending_candidates', 'active', 'ready_for_review')
  returning * into result_round;

  if result_round.id is null then
    raise exception 'selection round not found or not cancellable' using errcode = 'P0001';
  end if;

  return result_round;
end;
$$;

revoke all on function public.cancel_selection_round(uuid) from public;
grant execute on function public.cancel_selection_round(uuid) to authenticated;
