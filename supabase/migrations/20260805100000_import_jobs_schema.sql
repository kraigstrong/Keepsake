-- ADR-0015: URL import pipeline. import_jobs is household-scoped like
-- every other Phase 4+ table, one row per import attempt (not one row
-- per URL — retrying a failed import creates a new row, same as
-- resubmitting any other form). normalized_url is provenance/debugging
-- data only: duplicate detection itself happens in application code
-- (server/import/normalizeUrl.ts) against recipes.source_url, not via a
-- SQL-side comparison against this column, so normalization logic lives
-- in exactly one place (see ADR-0015 decision 5).
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  created_by uuid not null references auth.users(id),
  source_url text not null,
  normalized_url text not null,
  status text not null default 'processing' check (status in ('processing', 'complete', 'failed')),
  error_message text,
  recipe_id uuid references public.recipes(id),
  duplicate_of_recipe_id uuid references public.recipes(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index import_jobs_household_id_idx on public.import_jobs(household_id);

alter table public.import_jobs enable row level security;
