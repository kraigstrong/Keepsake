-- Phase 15 cooking events (prd.md §17-18, ADR-0024). One shared table
-- covers both "cooking history" and "cooking notes" — prd.md describes
-- them as the same list of events viewed two ways (a chronological
-- history whose entries optionally carry a note), not two entities.
-- household_id denormalized onto the table directly, same
-- is_household_member(household_id) RLS shape every table since Phase 3
-- uses, rather than a join back through recipes.

create table if not exists public.cooking_events (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  cooked_at timestamptz not null,
  -- Short optional note ("Needed another tsp salt.", prd.md §18) —
  -- deliberately not required; Done Cooking always records completion,
  -- the note prompt can be skipped.
  note text,
  cooked_by uuid not null references auth.users (id),
  -- Client-generated idempotency key (ADR-0024 decision 3) — the local
  -- offline outbox uses this as its own row id, so replaying a queued
  -- submission after a partial failure is always a safe upsert, never a
  -- duplicate. Unique, not the primary key: id stays a normal
  -- server-generated uuid like every other table, client_event_id is
  -- purely the dedup key record_cooking_event() upserts on.
  client_event_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_cooking_events_recipe_id on public.cooking_events (recipe_id);
create index if not exists idx_cooking_events_household_id on public.cooking_events (household_id);
-- Recipe Detail's history list reads newest-first (prd.md §18's
-- "newest note preview appears near top") — this index serves that
-- query pattern directly.
create index if not exists idx_cooking_events_recipe_cooked_at
  on public.cooking_events (recipe_id, cooked_at desc);
