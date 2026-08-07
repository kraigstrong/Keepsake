-- Phase 12 weekly plan model (prd.md §15, §26, ADR-0021). household_id
-- denormalized onto planning_entries too, same reasoning as
-- recipe_schema.sql: every RLS policy uses the same
-- is_household_member(household_id) shape rather than a join back
-- through weekly_plans.

create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- ISO year-week ("2026-W32") of the "current week" this plan belongs
  -- to, computed client-side (ADR-0021: no stored household timezone
  -- exists to derive this server-side) and validated by
  -- get_or_create_current_weekly_plan(), never set by direct client
  -- insert.
  week_key text not null check (week_key ~ '^\d{4}-W\d{2}$'),
  status text not null default 'planning' check (status in ('planning', 'confirmed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, week_key)
);

create index if not exists idx_weekly_plans_household_id on public.weekly_plans (household_id);

create table if not exists public.planning_entries (
  id uuid primary key default gen_random_uuid(),
  weekly_plan_id uuid not null references public.weekly_plans (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  servings integer not null check (servings > 0),
  position integer not null default 0,
  added_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Set true the first time confirm_weekly_plan() counts this entry
  -- toward its recipe's planned_count. Per-entry rather than per-confirm
  -- so an Edit Plan -> add/remove -> re-confirm cycle never double-counts
  -- an entry the first confirm already counted (ADR-0021).
  counted boolean not null default false
);

create index if not exists idx_planning_entries_weekly_plan_id
  on public.planning_entries (weekly_plan_id);
create index if not exists idx_planning_entries_recipe_id
  on public.planning_entries (recipe_id);

alter table public.weekly_plans enable row level security;
alter table public.planning_entries enable row level security;

-- FREQ-01: Frequently Selected reads this directly, same as Library's
-- other Smart-sort columns already do. Only confirm_weekly_plan() ever
-- increments it (ADR-0021) — never decremented, so it reflects
-- cumulative planning activity, not current-week state.
alter table public.recipes add column if not exists planned_count integer not null default 0;
