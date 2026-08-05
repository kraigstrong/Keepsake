-- Phase 8's own security scope (execution-plan.md) explicitly lists
-- "Rate limits and cost controls" — not yet addressed when this table
-- and its RPCs first landed. Mirrors invitation_abuse_controls.sql's
-- pattern exactly: a short cooldown plus a rolling-window count cap,
-- checked before any expensive work starts (create_import_job is the
-- very first write in the pipeline, before the fetch or the Anthropic
-- call ever runs), so a compromised or scripted client calling the Edge
-- Function directly (bypassing the UI's own isImporting-disabled
-- button) can't spam real Anthropic spend or repeatedly exercise the
-- SSRF-hardened fetcher against arbitrary targets. Redefines
-- create_import_job() with two guards added before insert; everything
-- else is unchanged.
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

  insert into public.import_jobs (household_id, created_by, source_url, normalized_url)
  values (caller_household_id, auth.uid(), source_url, normalized_url)
  returning * into result_job;

  return result_job;
end;
$$;
