-- Phase 3: household model (prd.md §6, §26). RLS is enabled here even
-- though policies land in a later migration (execution-plan.md's Phase 3
-- commit sequence splits schema from RLS helpers/policies) — an RLS-enabled
-- table with zero policies denies all access by default, so there's no
-- window where these tables are open before their policies exist.

-- prd.md's "User" data-model entity: one row per auth identity, holding
-- the household-facing display name auth.users itself doesn't have.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.households enable row level security;

-- prd.md §5 excludes "Multiple households" from MVP scope, and §6 is a
-- singular "One household. Multiple members." — so membership is one row
-- per user, ever (also matches ADR-0004: fixed once joined, no leaving).
create table if not exists public.household_membership (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.household_membership enable row level security;
