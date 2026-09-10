-- Every write in `public` goes through a SECURITY DEFINER RPC; the two
-- client roles hold `select` and nothing more. That was true only by
-- accident until now. No migration ever revoked the write privileges —
-- the property came from Supabase CLI 2.115.0 narrowing the public
-- schema's default privileges for `anon`/`authenticated` to `Dxtm`.
-- CLI 2.116.0 stopped narrowing them, and the bare postgres image has
-- never narrowed them, so a hosted project has almost certainly carried
-- these grants all along with RLS the only thing refusing the writes.
--
-- So this migration tightens the real project rather than merely
-- restoring a local default. It is safe to apply because nothing has
-- been exercising those grants: the only INSERT/UPDATE/DELETE policies
-- in `public` are the two on `profiles` below, and with no policy to
-- match, RLS was already refusing every other client write.
--
-- Two layers, both explicit from here on:
--   1. default privileges, so a table added by a later migration starts
--      without write grants instead of inheriting them;
--   2. a revoke covering the tables that already exist.
--
-- `service_role` is deliberately untouched — it bypasses RLS by design
-- and is the role the Edge Functions authenticate as. TRUNCATE is left
-- as-is too: it was granted under 2.115.0 as well, so removing it is a
-- separate change, not part of restoring this invariant.
--
-- Regression test: the "writes denied" assertions across
-- supabase/tests/database/*.test.sql, which fail on a database built
-- without this migration.

alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon, authenticated;

revoke insert, update, delete on all tables in schema public
  from anon, authenticated;

-- The one intentional direct-write path: a signed-in user maintains
-- their own row, fenced by the `id = auth.uid()` policies added in
-- 20260802120300. No delete — account removal is an RPC.
grant insert, update on public.profiles to authenticated;
