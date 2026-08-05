-- ADR-0016 decisions 2-3: idempotent replay on create_import_job, and
-- the new create_import_batch for bulk paste. Redefines
-- create_import_job (adds client_import_id, optional, defaulted so
-- Phase 8's existing single-URL call site keeps working unchanged) and
-- adds create_import_batch alongside it. Both re-derive household_id
-- from auth.uid(), never take it from the caller, same pattern as
-- every RPC since save_recipe.
--
-- Adding a third parameter changes create_import_job's signature, so
-- `create or replace` alone would leave the old two-arg overload
-- resolving ahead of this one for existing two-arg call sites (exact
-- arity match wins over a default-filled one in Postgres's overload
-- resolution) — the old version has to be dropped explicitly first,
-- not just shadowed.
drop function if exists public.create_import_job(text, text);

create or replace function public.create_import_job(
  source_url text,
  normalized_url text,
  client_import_id uuid default null
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

  -- Idempotent replay: a client-supplied id already seen for this
  -- household returns the existing row as-is (whatever its current
  -- status), instead of inserting a duplicate or erroring. This isn't a
  -- new import attempt, so it skips the cooldown/cap guards below
  -- entirely rather than competing with real new imports for headroom.
  if client_import_id is not null then
    select * into result_job
    from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.client_import_id = create_import_job.client_import_id;

    if found then
      return result_job;
    end if;
  end if;

  if exists (
    select 1 from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'please wait before importing another recipe' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'too many imports for this household in the last hour' using errcode = 'P0001';
  end if;

  insert into public.import_jobs (household_id, created_by, source_url, normalized_url, client_import_id)
  values (
    caller_household_id,
    auth.uid(),
    create_import_job.source_url,
    create_import_job.normalized_url,
    create_import_job.client_import_id
  )
  returning * into result_job;

  return result_job;
end;
$$;

revoke all on function public.create_import_job(text, text, uuid) from public;
grant execute on function public.create_import_job(text, text, uuid) to authenticated;

-- Reserves N job rows up front (status 'processing') so the client has
-- something to poll immediately, before a single Claude call has run.
-- Takes raw urls only — normalization (server/import/normalizeUrl.ts)
-- is Deno/server-only code, not something the client can compute, so
-- normalized_url is stored equal to the raw url here as a placeholder;
-- same as every other import_jobs row, it's provenance/debugging data
-- only (ADR-0015 decision 4), never compared against for duplicate
-- detection. The per-item import-recipe Edge Function call each batch
-- job goes through afterward computes the real normalized form itself
-- and does the actual duplicate check, exactly like the single-URL
-- path already does. Capped at 20 per batch — comfortably under the
-- existing 30/rolling-hour household cap rather than able to exhaust
-- it in one call (ADR-0016 decision 3).
create or replace function public.create_import_batch(
  urls text[],
  client_batch_id uuid default null
)
returns table (
  batch_id uuid,
  job_id uuid,
  source_url text,
  normalized_url text,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_household_id uuid;
  existing_batch_id uuid;
  new_batch_id uuid;
  url_count integer;
  i integer;
begin
  caller_household_id := public.my_household_id();
  if caller_household_id is null then
    raise exception 'caller does not belong to a household' using errcode = 'P0001';
  end if;

  url_count := coalesce(array_length(urls, 1), 0);
  if url_count = 0 then
    raise exception 'a batch must include at least one url' using errcode = 'P0001';
  end if;
  if url_count > 20 then
    raise exception 'a batch cannot include more than 20 urls' using errcode = 'P0001';
  end if;

  -- Idempotent replay at the batch level (ADR-0016 decision 3): a
  -- client_batch_id already seen for this household returns the
  -- existing batch's jobs as-is, skipping every guard below.
  if client_batch_id is not null then
    select import_batches.id into existing_batch_id
    from public.import_batches
    where import_batches.household_id = caller_household_id
      and import_batches.client_batch_id = create_import_batch.client_batch_id;

    if found then
      return query
        select import_jobs.batch_id, import_jobs.id, import_jobs.source_url,
               import_jobs.normalized_url, import_jobs.status
        from public.import_jobs
        where import_jobs.batch_id = existing_batch_id
        order by import_jobs.created_at;
      return;
    end if;
  end if;

  if exists (
    select 1 from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'please wait before importing another recipe' using errcode = 'P0001';
  end if;

  -- Atomic against the whole batch, not per-item: reject the entire
  -- batch up front if it would push the household over the cap, so the
  -- client never has to reconcile which of N urls silently didn't
  -- queue.
  if (
    select count(*) from public.import_jobs
    where import_jobs.household_id = caller_household_id
      and import_jobs.created_at > now() - interval '1 hour'
  ) + url_count > 30 then
    raise exception 'this batch would exceed the household''s hourly import limit' using errcode = 'P0001';
  end if;

  insert into public.import_batches (household_id, created_by, client_batch_id, total_count)
  values (caller_household_id, auth.uid(), create_import_batch.client_batch_id, url_count)
  returning id into new_batch_id;

  for i in 1..url_count loop
    insert into public.import_jobs (household_id, created_by, source_url, normalized_url, batch_id)
    values (caller_household_id, auth.uid(), urls[i], urls[i], new_batch_id);
  end loop;

  return query
    select import_jobs.batch_id, import_jobs.id, import_jobs.source_url,
           import_jobs.normalized_url, import_jobs.status
    from public.import_jobs
    where import_jobs.batch_id = new_batch_id
    order by import_jobs.created_at;
end;
$$;

revoke all on function public.create_import_batch(text[], uuid) from public;
grant execute on function public.create_import_batch(text[], uuid) to authenticated;
