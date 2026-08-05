-- Defense-in-depth alongside claim_import_job (same migration set):
-- application-level duplicate detection (ADR-0015 decision 4) compares
-- normalized URLs in code, not a database constraint, by design — but
-- that means nothing at the database level ever stopped two concurrent
-- save_recipe calls for the exact same raw source_url from both
-- succeeding. claim_import_job closes the specific race that produced
-- that outcome; this index makes the outcome itself structurally
-- impossible regardless of whether some other concurrency bug reaches
-- save_recipe in the future. A second concurrent save for the same URL
-- now fails outright (a real, visible import failure) instead of
-- silently duplicating.
--
-- Partial (source_url is not null) for the same reason recipe_drafts'
-- and import_jobs' partial unique indexes are (ADR-0011, ADR-0016):
-- manually-created recipes have no source_url at all, and Postgres
-- already treats every null as distinct, so this would be a no-op
-- constraint for them regardless — being explicit documents the intent
-- rather than relying on that null-handling incidentally.
create unique index recipes_household_source_url_idx
  on public.recipes (household_id, source_url)
  where source_url is not null;
