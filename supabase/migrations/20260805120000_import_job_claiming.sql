-- ADR-0016 follow-up — closes a real race found via live testing, not
-- just reasoned about: two concurrent callers could both find the same
-- still-'processing' job (either via the idempotent client_import_id
-- lookup finding a genuinely in-flight job, or two concurrent
-- batch-item calls both resolving the same jobId) and both proceed to
-- run the full fetch/extract/save pipeline independently — each
-- calling save_recipe (always a create from this path, never an edit),
-- producing two separate recipes for one import. The existing
-- idempotent-replay check ("if job.status !== 'processing', return the
-- stored outcome") only protects against replaying an *already-
-- finished* job; it does nothing for two callers who both find the
-- same job while it's still genuinely in flight.
--
-- claimed_at makes "who actually gets to run the pipeline for this
-- job" an atomic, single-winner operation. A stale claim (the
-- claimer's own request died mid-flight, e.g. an app kill) is
-- reclaimable after 60 seconds — long enough that a real in-flight
-- pipeline run (~13s per the Phase 1 risk spike's own measurement) is
-- never mistaken for abandoned.
alter table public.import_jobs add column claimed_at timestamptz;

create or replace function public.claim_import_job(job_id uuid)
returns public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  result_job public.import_jobs;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  update public.import_jobs
  set claimed_at = now()
  where import_jobs.id = claim_import_job.job_id
    and import_jobs.household_id = caller_household_id
    and import_jobs.status = 'processing'
    and (import_jobs.claimed_at is null or import_jobs.claimed_at < now() - interval '60 seconds')
  returning * into result_job;

  if result_job is null then
    raise exception 'import already in progress for this request' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.claim_import_job(uuid) from public;
grant execute on function public.claim_import_job(uuid) to authenticated;
