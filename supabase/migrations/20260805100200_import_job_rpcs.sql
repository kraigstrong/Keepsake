-- ADR-0015: three narrow RPCs bracket the Edge Function's work — create
-- the job row before any slow/external work starts (so a job always
-- exists even if the function crashes mid-pipeline), then exactly one of
-- complete/fail closes it out. All three re-derive household_id from
-- auth.uid(), never take it from the caller, same pattern as save_recipe.

create or replace function public.create_import_job(source_url text, normalized_url text)
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

  insert into public.import_jobs (household_id, created_by, source_url, normalized_url)
  values (caller_household_id, auth.uid(), source_url, normalized_url)
  returning * into result_job;

  return result_job;
end;
$$;

revoke all on function public.create_import_job(text, text) from public;
grant execute on function public.create_import_job(text, text) to authenticated;

-- recipe_id is required (either a freshly created recipe, or the
-- existing recipe a duplicate resolved to); duplicate_of_recipe_id is
-- only set in the duplicate case. Both are validated as belonging to the
-- caller's own household — a job can't be closed out pointing at a
-- recipe the caller can't actually see.
create or replace function public.complete_import_job(
  job_id uuid,
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
  where id = job_id and household_id = caller_household_id and status = 'processing'
  returning * into result_job;

  if result_job is null then
    raise exception 'import job not found or already closed' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.complete_import_job(uuid, uuid, uuid) from public;
grant execute on function public.complete_import_job(uuid, uuid, uuid) to authenticated;

create or replace function public.fail_import_job(job_id uuid, error_message text)
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
  where id = job_id and household_id = caller_household_id and status = 'processing'
  returning * into result_job;

  if result_job is null then
    raise exception 'import job not found or already closed' using errcode = 'P0001';
  end if;

  return result_job;
end;
$$;

revoke all on function public.fail_import_job(uuid, text) from public;
grant execute on function public.fail_import_job(uuid, text) to authenticated;
