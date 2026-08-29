-- threat-model.md T22's recorded gap, now due: cooking_events.note had no
-- length bound on either side, and T22 said to close it "before Phase 15's
-- note-capture UI ships a real path to populate it". That UI has since
-- shipped (DoneCookingSheet.tsx), so the precondition is met.
--
-- 2000 chars is the bound because note is documented as short ("Needed
-- another tsp salt.", prd.md §18) — generous for that, small enough that a
-- scripted client can't inflate a row the whole household then syncs down
-- (ADR-0013 pages every member's device off recipes/cooking_events).
--
-- Placed on the table, not in record_cooking_event: the RPC is the only
-- write path today, but a check here holds for any future one too.
alter table public.cooking_events
  add constraint cooking_events_note_length_check
  check (note is null or char_length(note) <= 2000);
