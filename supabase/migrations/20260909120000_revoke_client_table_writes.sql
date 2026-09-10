-- Every write in `public` goes through a SECURITY DEFINER RPC, so the
-- client roles need `select` and nothing else. That was true only by
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
-- Three layers, all explicit from here on:
--   1. default privileges, so a table added by a later migration starts
--      without write grants instead of inheriting them;
--   2. a revoke covering the tables that already exist;
--   3. both of those cover PUBLIC as well as the two named roles —
--      every role inherits PUBLIC, so a grant made there is a write
--      grant to `authenticated` under another name.
--
-- No `for role` clause: ALTER DEFAULT PRIVILEGES then targets the role
-- running this migration, which is the role that will create the future
-- tables this is meant to cover. Naming `postgres` explicitly would
-- raise `permission denied to change default privileges` and fail the
-- migration outright if the project applies migrations as anything else
-- (#205). Untargeted is both safer and more accurate.
--
-- `service_role` is deliberately untouched. Not because request paths
-- use it — AGENTS.md makes service-role access in a client-triggerable
-- path a hard stop, and all three Edge Functions authenticate with the
-- caller's JWT — but because it is the role behind the one written-down
-- exception, `delete-account`'s `auth.admin.deleteUser` (ADR-0028), and
-- narrowing it here would be an unrelated change to that boundary.
--
-- TRUNCATE is left as-is (#206): it was granted under 2.115.0 too, so
-- removing it is a separate change, not part of restoring this
-- invariant. `anon`'s SELECT is likewise untouched and so remains
-- CLI-dependent — absent under 2.115.0, present on all tables under
-- 2.116.0 (#207).
--
-- Regression test: client_write_grants.test.sql, plus the "writes
-- denied" assertions across supabase/tests/database/*.test.sql.

alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated, public;

revoke insert, update, delete on all tables in schema public
  from anon, authenticated, public;

-- The one intentional direct-write path: a signed-in user maintains
-- their own row, fenced by the `id = auth.uid()` policies added in
-- 20260802120300. No delete — account removal is an RPC.
grant insert, update on public.profiles to authenticated;
