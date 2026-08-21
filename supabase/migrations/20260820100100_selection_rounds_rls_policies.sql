-- Read access only, same is_household_member() helper as every other
-- table since Phase 4. No insert/update/delete policies or grants to
-- authenticated on any of the four tables in this slice — all writes go
-- through SECURITY DEFINER RPCs landing in the next PR, which will
-- re-derive the caller's household from auth.uid() themselves rather
-- than trusting a client-supplied household_id (same shape as
-- save_recipe / the weekly-plan RPCs).

create policy "Members can select their household's selection rounds"
  on public.selection_rounds
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.selection_rounds to authenticated;

create policy "Members can select their household's selection round participants"
  on public.selection_round_participants
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.selection_round_participants to authenticated;

create policy "Members can select their household's selection round candidates"
  on public.selection_round_candidates
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.selection_round_candidates to authenticated;

-- ADR-0027 decision 2: blind ballots while a round is active, revealed
-- once it completes. This is an allowlist of the two statuses that
-- SHOULD reveal (ready_for_review, applied) — deliberately not the
-- obvious-looking `status != 'active'` form.
--
-- Why the allowlist and not `!=`: closing a round (active -> ready_for_
-- review) is creator-only, but cancelling it (active/ready_for_review ->
-- cancelled) is open to any household member (ADR-0027 decision 3).
-- 'cancelled' satisfies `status != 'active'` just as much as
-- 'ready_for_review' or 'applied' does, so the `!=` phrasing would let
-- any participant cancel a round mid-flight and immediately read
-- everyone else's blind ballots — a disclosure path that routes
-- straight around the creator-only close gate. Nobody who swiped in a
-- cancelled round ever consented to a reveal, because the reveal is
-- what closing *means* and a cancellation is an abort, not a close
-- (ADR-0027 decision 2). Enumerating the two statuses that should
-- reveal means a future fifth status defaults to private instead of
-- defaulting to exposed. See selection_rounds_schema.test.sql's
-- "cancelled round keeps decisions private" cases — the regression test
-- for this exact bug.
--
-- This is necessary but not sufficient on its own: a future SECURITY
-- DEFINER results function bypasses RLS entirely and must independently
-- enforce this same allowlist (ADR-0027 decision 2) — that guard lands
-- with the RPC in a later PR, not here.
create policy "Members can select their own decisions, or anyone's once revealed"
  on public.selection_decisions
  for select
  to authenticated
  using (
    public.is_household_member(household_id)
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.selection_rounds r
        where r.id = round_id and r.status in ('ready_for_review', 'applied')
      )
    )
  );

grant select on public.selection_decisions to authenticated;
