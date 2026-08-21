-- Milestone 4 (Smart Meal Selection / "Help Me Choose"), spine schema.
-- ADR-0027 is authoritative; where docs/proposals/smart-meal-selection-
-- architecture.md disagrees with it (see that doc's supersession
-- banner), the ADR wins. Four additive tables, no changes to recipes,
-- weekly_plans, or planning_entries. Full schema ships now even though
-- the first work item only builds the solo flow (docs/current.md,
-- 2026-08-20 build-order decision) — a solo round is a one-participant
-- group round as far as Postgres is concerned, so mode/closes_at/
-- selection_round_participants exist unused until the group work item.
--
-- household_id is denormalized onto every child table, same reasoning
-- as weekly_plan_schema.sql: every RLS policy uses the same
-- is_household_member(household_id) shape rather than joining back
-- through selection_rounds.
--
-- This slice is schema + RLS + pgTAP only. No RPCs — those are the next
-- PR, so several columns here (claim_token, revealed_at,
-- candidate_strategy_version) are written by RPCs that don't exist yet.

create table if not exists public.selection_rounds (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  mode text not null check (mode in ('solo', 'group')),
  -- Born pending_candidates, not active (ADR-0027 decision 1a): creation
  -- spans two commits around out-of-Postgres scoring (decision 5), and
  -- an initial status of 'active' would leave a half-finished creation
  -- both visibly broken and, worse, invisible-and-blocking under the
  -- singleton index below. A later finalize_selection_round_candidates
  -- performs the pending_candidates -> active transition atomically as
  -- part of writing the deck.
  status text not null default 'pending_candidates'
    check (status in ('pending_candidates', 'active', 'ready_for_review', 'applied', 'cancelled')),
  -- Advisory "meals to find" target driving deck size (a later RPC's
  -- concern) — not enforced as a hard cap on decisions or candidates.
  target_count integer check (target_count is null or target_count > 0),
  -- Soft "wrap up by" deadline for a group round; null for solo, which
  -- has no deadline concept (ADR-0027 decision 3/4).
  closes_at timestamptz,
  -- Versions the scoring heuristic that produced this round's deck
  -- (server/selection/scoreCandidates.ts, ADR-0027 decision 5). Null
  -- until finalize_selection_round_candidates writes it alongside the
  -- deck — a pending_candidates round hasn't been scored yet.
  candidate_strategy_version text,
  -- Fencing token for the two-commit creation path (ADR-0027 decision
  -- 1a), mirroring import_jobs.claim_token (ADR-0020). create_selection_
  -- round mints this on the pending round; finalize_selection_round_
  -- candidates must present a matching token in a single atomic
  -- status-guarded UPDATE, so a superseded or delayed creation attempt
  -- can never activate a stale round. Just the column in this slice —
  -- the RPCs that read/write it land in the next PR.
  claim_token uuid,
  -- Set the first time this round reaches ready_for_review. A later
  -- refill_selection_round RPC (group flow, ADR-0027 decision 2a)
  -- freezes decisions on any candidate that existed as of this
  -- timestamp, so re-opening the round for "suggest a few more" can't
  -- be used to change an already-revealed vote. Just the column here.
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  applied_at timestamptz,
  applied_by uuid references auth.users (id),
  applied_weekly_plan_id uuid references public.weekly_plans (id)
);

-- ADR-0027 decision 1/1a: at most one non-terminal round per household.
-- The predicate deliberately spans all three non-terminal statuses, not
-- just 'active' — scoping it to 'active' alone (or even 'pending_
-- candidates'/'active' together) leaves ready_for_review uncovered, and
-- ready_for_review is not terminal: a refill sends it back to active.
-- Without ready_for_review in the predicate, a round could sit in review
-- while a second round starts, and refilling the first would then
-- collide with the second. Covering all three is what makes "one round
-- at a time" a property of the schema rather than a claim in prose.
create unique index selection_rounds_household_non_terminal_idx
  on public.selection_rounds (household_id)
  where status in ('pending_candidates', 'active', 'ready_for_review');

create index if not exists idx_selection_rounds_household_id
  on public.selection_rounds (household_id);

create table if not exists public.selection_round_participants (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "Left midway" is just "still null" — no distinct state exists for
  -- it (ADR-0027 decision 1, matching the proposal's participant model).
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists idx_selection_round_participants_household_id
  on public.selection_round_participants (household_id);

create table if not exists public.selection_round_candidates (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  -- Snapshot of the ranking score at generation time. Never recomputed
  -- or mutated after insert (see comment below) — a later re-score
  -- writes new rows via refill, it doesn't touch this one.
  score numeric not null,
  -- Up to two signals in priority order backing "why this recipe?"
  -- (ADR-0027 / proposal §5). Same shape as recipes.tags.
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (round_id, recipe_id)
);

-- Never mutated once written (ADR-0027 decision 1): a recipe's
-- availability (archived/deleted) is re-checked live at read and apply
-- time instead of an "excluded" flag here, so the historical deck stays
-- stable for consensus math even if a recipe is archived mid-round. No
-- UPDATE grant exists for this table (next migration) — this comment
-- records the intent, the grants enforce it.
comment on table public.selection_round_candidates is
  'Append-only: a candidate row is never updated after insert. Availability is re-checked live, not tracked here.';

create index if not exists idx_selection_round_candidates_household_id
  on public.selection_round_candidates (household_id);

create table if not exists public.selection_decisions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision text not null check (decision in ('yes', 'no')),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, recipe_id, user_id)
);

-- Deliberately no third "unseen"/"skip" value. Absence of a row is what
-- "not yet decided" means, and that is the whole guarantee (ADR-0027
-- decision 1, "Alternatives considered"): there is no code path that
-- can turn "never decided" into a persisted negative, because there is
-- nothing to write. Do not add a 'skip' decision value here — that
-- reintroduces exactly the bug this design exists to make structurally
-- impossible.
comment on column public.selection_decisions.decision is
  'yes|no only. "Unseen" is deliberately the absence of a row, not a third value — see ADR-0027 decision 1.';

create index if not exists idx_selection_decisions_household_id
  on public.selection_decisions (household_id);

alter table public.selection_rounds enable row level security;
alter table public.selection_round_participants enable row level security;
alter table public.selection_round_candidates enable row level security;
alter table public.selection_decisions enable row level security;
