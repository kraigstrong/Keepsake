-- Read access only, same is_household_member() helper as import_jobs and
-- every other Phase 4+ table. No insert/update/delete grant for
-- authenticated — the only write path is create_import_batch (next
-- migration), which re-derives the caller's household from auth.uid()
-- itself rather than trusting a client-supplied household_id.

create policy "Members can select their household's import batches"
  on public.import_batches
  for select
  to authenticated
  using (public.is_household_member(household_id));

grant select on public.import_batches to authenticated;
