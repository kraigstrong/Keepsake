-- Phase 0 scaffolding: proves the migration + RLS + pgTAP pattern this
-- project follows, before any real domain schema exists. Not a product
-- table. Remove once Phase 3 lands real household-scoped tables and the
-- pattern has a genuine example to point to instead.

create table if not exists public.example_widgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.example_widgets enable row level security;

-- Mirrors the shape Phase 3's household RLS will take: a row is visible
-- only to the identity it's scoped to, enforced server-side, not by
-- client-side filtering (execution-plan.md §2.6 / prd.md §30).
create policy "Owners can select their own widgets"
  on public.example_widgets
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "Owners can insert their own widgets"
  on public.example_widgets
  for insert
  to authenticated
  with check (owner_id = auth.uid());
