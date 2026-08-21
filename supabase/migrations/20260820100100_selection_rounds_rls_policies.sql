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

-- ADR-0027 decision 2: the allowlist form is required, not stylistic.
-- `status != 'active'` looks equivalent and is not — 'cancelled'
-- satisfies it, and cancelling is open to any member while closing is
-- creator-only, so `!=` becomes a ballot-disclosure path. A future
-- SECURITY DEFINER results function bypasses RLS entirely and must
-- enforce this same allowlist independently. Regression test:
-- selection_rounds_schema.test.sql, "cancelling round A2 does NOT
-- reveal bob's decision to alice".
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
