-- ADR-0020 (Phase 11.5): forward-only rewrite of claim_import_job,
-- complete_import_job, and fail_import_job (Phases 8/9, already
-- shipped) to check claim_token, plus a new finalize_import_job that
-- merges save_recipe and job completion into one transaction so a
-- failure between them can never leave a real recipe paired with a
-- job stuck 'processing' forever.

-- claim_import_job: now generates and returns a fresh claim_token on
-- every successful claim, and the staleness window moves from 60s to
-- 180s. Fencing (below) is what actually makes a duplicate/late
-- completion harmless now, not the window's length — a longer window
-- only costs a slower reclaim of a genuinely-dead worker, not
-- correctness, so there's no reason to keep it tight.
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
  set claimed_at = now(), claim_token = gen_random_uuid()
  where import_jobs.id = claim_import_job.job_id
    and import_jobs.household_id = caller_household_id
    and import_jobs.status = 'processing'
    and (import_jobs.claimed_at is null or import_jobs.claimed_at < now() - interval '180 seconds')
  returning * into result_job;

  if result_job is null then
    raise exception 'import already in progress for this request' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.claim_import_job(uuid) from public;
grant execute on function public.claim_import_job(uuid) to authenticated;

-- complete_import_job: still used for the duplicate-URL short-circuit
-- path (an existing recipe id is linked, save_recipe is never called,
-- so there's nothing for it to be atomic *with*) — gains the same
-- claim_token check every other closing RPC gets, so a superseded
-- worker can't close out a job it no longer holds the claim for.
drop function if exists public.complete_import_job(uuid, uuid, uuid);

create or replace function public.complete_import_job(
  job_id uuid,
  claim_token uuid,
  recipe_id uuid,
  duplicate_of_recipe_id uuid default null
)
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

  if not exists (
    select 1 from public.recipes
    where id = complete_import_job.recipe_id and household_id = caller_household_id
  ) then
    raise exception 'recipe not found' using errcode = 'P0001';
  end if;

  update public.import_jobs set
    status = 'complete',
    recipe_id = complete_import_job.recipe_id,
    duplicate_of_recipe_id = complete_import_job.duplicate_of_recipe_id,
    updated_at = now()
  where id = job_id
    and household_id = caller_household_id
    and status = 'processing'
    and import_jobs.claim_token = complete_import_job.claim_token
  returning * into result_job;

  if result_job is null then
    raise exception 'import job not found, already closed, or claim no longer held' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.complete_import_job(uuid, uuid, uuid, uuid) from public;
grant execute on function public.complete_import_job(uuid, uuid, uuid, uuid) to authenticated;

drop function if exists public.fail_import_job(uuid, text);

create or replace function public.fail_import_job(job_id uuid, claim_token uuid, error_message text)
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

  update public.import_jobs set
    status = 'failed',
    error_message = fail_import_job.error_message,
    updated_at = now()
  where id = job_id
    and household_id = caller_household_id
    and status = 'processing'
    and import_jobs.claim_token = fail_import_job.claim_token
  returning * into result_job;

  if result_job is null then
    raise exception 'import job not found, already closed, or claim no longer held' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.fail_import_job(uuid, uuid, text) from public;
grant execute on function public.fail_import_job(uuid, uuid, text) to authenticated;

-- finalize_import_job: the actual atomicity fix. save_recipe and the
-- job's completion now happen inside one function body, so they commit
-- or roll back together as part of the single statement that invokes
-- this function -- a failure partway through (e.g. save_recipe raising
-- on a malformed payload) rolls back any partial job update too,
-- leaving the job exactly as it was ('processing'), never half-done.
-- Calling save_recipe(payload) directly rather than duplicating its
-- body: a nested security definer call runs inside the same
-- transaction as its caller, so this gets atomicity for free without a
-- second copy of ~240 lines of insert/section/version logic to keep in
-- sync.
--
-- Replaying against an already-'complete' job (a retried finalize call
-- after the DB commit but before the Edge Function's own response made
-- it back to the client, or a claim_token mismatch after a reclaim
-- raced a finalize that had actually already landed) returns the
-- stored job as-is rather than erroring or re-running save_recipe --
-- same idempotent-replay convention the rest of this pipeline already
-- uses.
create or replace function public.finalize_import_job(
  job_id uuid,
  claim_token uuid,
  recipe_payload jsonb,
  duplicate_of_recipe_id uuid default null
)
returns public.import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  locked_job public.import_jobs;
  result_recipe public.recipes;
  result_job public.import_jobs;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  select * into locked_job from public.import_jobs
  where id = job_id and household_id = caller_household_id
  for update;

  if locked_job.id is null then
    raise exception 'import job not found' using errcode = 'P0001';
  end if;

  if locked_job.status = 'complete' then
    return locked_job;
  end if;

  if locked_job.status != 'processing' then
    raise exception 'import job not found or already closed' using errcode = 'P0001';
  end if;

  if locked_job.claim_token is distinct from finalize_import_job.claim_token then
    raise exception 'import job claim no longer held' using errcode = 'P0001';
  end if;

  select public.save_recipe(recipe_payload) into result_recipe;

  update public.import_jobs set
    status = 'complete',
    recipe_id = result_recipe.id,
    duplicate_of_recipe_id = finalize_import_job.duplicate_of_recipe_id,
    updated_at = now()
  where id = job_id
  returning * into result_job;

  return result_job;
end;
$$;

revoke all on function public.finalize_import_job(uuid, uuid, jsonb, uuid) from public;
grant execute on function public.finalize_import_job(uuid, uuid, jsonb, uuid) to authenticated;
