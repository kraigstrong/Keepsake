-- Phase 13 (ADR-0022). The grocery list itself is never persisted — it
-- is recomputed on every review-screen load from planning_entries +
-- recipe_ingredients (already RLS-authorized). This table holds only
-- the one thing that must survive a regeneration: a household member's
-- explicit include/exclude choice for a canonical item, keyed by a
-- deterministic hash of that item's canonical identity (server/groceries,
-- not this migration) rather than by any row this schema owns. A row
-- exists only when a user has actually toggled an item away from its
-- computed default (staple -> excluded, everything else -> included) —
-- sparse by construction, not a snapshot of every generated list.

create table if not exists public.grocery_item_selections (
  id uuid primary key default gen_random_uuid(),
  weekly_plan_id uuid not null references public.weekly_plans (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  item_hash text not null,
  included boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users (id),
  unique (weekly_plan_id, item_hash)
);

create index if not exists idx_grocery_item_selections_weekly_plan_id
  on public.grocery_item_selections (weekly_plan_id);

alter table public.grocery_item_selections enable row level security;
