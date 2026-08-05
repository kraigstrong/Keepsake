-- ADR-0016: bulk URL import. import_batches is household-scoped like
-- every other Phase 4+ table, one row per bulk-paste submission.
-- client_batch_id is the idempotency key for a retried submission (a
-- network blip after the server already received it should not create a
-- second batch) — nullable because nothing requires one, but unique per
-- household when supplied so a replay can be detected.
create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  created_by uuid not null references auth.users(id),
  client_batch_id uuid,
  total_count integer not null check (total_count > 0),
  created_at timestamptz not null default now()
);

create index import_batches_household_id_idx on public.import_batches(household_id);

create unique index import_batches_household_client_id_idx
  on public.import_batches(household_id, client_batch_id)
  where client_batch_id is not null;

alter table public.import_batches enable row level security;

-- batch_id links a job to the batch it was created as part of (null for
-- Phase 8's existing single-URL in-app import flow, which never
-- involves a batch). client_import_id is the per-job idempotency key
-- the durable Share Extension outbox mints at capture time (ADR-0016
-- decision 2) — also nullable and unique per household when supplied,
-- same partial-index pattern as recipe_drafts' (ADR-0011).
alter table public.import_jobs
  add column batch_id uuid references public.import_batches(id),
  add column client_import_id uuid;

create index import_jobs_batch_id_idx on public.import_jobs(batch_id);

create unique index import_jobs_household_client_import_id_idx
  on public.import_jobs(household_id, client_import_id)
  where client_import_id is not null;
