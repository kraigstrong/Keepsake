-- Phase 16 lifecycle RPCs (ADR-0025): archive_recipe, unarchive_recipe,
-- delete_recipe, restore_recipe, permanently_delete_recipe. Covers
-- server authorization, idempotency, the restore/source_url-collision
-- amendment, permanently_delete_recipe's deleted-only gate, and that it
-- still fires Phase 6's existing deleted_recipes tombstone trigger.

begin;

select plan(29);

insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'carol@example.test');

insert into public.households (id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

insert into public.recipes (id, household_id, title, source_url, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A1', 'https://example.test/a1', '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Recipe A2', null, '11111111-1111-1111-1111-111111111111'),
  ('20000000-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Recipe B1', null, '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- archive_recipe / unarchive_recipe
select is(
  (select archived_at is not null from public.archive_recipe('20000000-0000-0000-0000-000000000002')),
  true,
  'archive_recipe: sets archived_at'
);
select lives_ok(
  $$ select public.archive_recipe('20000000-0000-0000-0000-000000000002') $$,
  'archive_recipe: archiving an already-archived recipe is idempotent, not an error'
);
select is(
  (select archived_at is null from public.unarchive_recipe('20000000-0000-0000-0000-000000000002')),
  true,
  'unarchive_recipe: clears archived_at'
);
select throws_ok(
  $$ select public.archive_recipe('20000000-0000-0000-0000-000000000003') $$,
  'recipe not found',
  'archive_recipe: rejects a recipe belonging to a different household'
);

-- delete_recipe
select is(
  (select deleted_at is not null from public.delete_recipe('20000000-0000-0000-0000-000000000002')),
  true,
  'delete_recipe: sets deleted_at'
);
select lives_ok(
  $$ select public.delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'delete_recipe: deleting an already-deleted recipe is idempotent, not an error'
);
select is(
  (select count(*)::int from public.deleted_recipes where id = '20000000-0000-0000-0000-000000000002'),
  0,
  'delete_recipe: a soft delete does not fire the hard-delete tombstone trigger'
);

-- restore_recipe
select is(
  (select deleted_at is null from public.restore_recipe('20000000-0000-0000-0000-000000000002')),
  true,
  'restore_recipe: clears deleted_at'
);
select throws_ok(
  $$ select public.restore_recipe('20000000-0000-0000-0000-000000000001') $$,
  'recipe not found or not deleted',
  'restore_recipe: rejects a recipe that is not currently deleted'
);

-- restore_recipe / source_url collision (ADR-0025 amendment): delete
-- A1 (source_url set), "re-import" by inserting an independent B-shaped
-- row with the same source_url (mirrors what save_recipe would do once
-- recipes_household_source_url_idx excludes deleted rows), then restore
-- A1 and confirm it comes back with source_url detached instead of
-- raising. authenticated has no direct INSERT grant on recipes (every
-- write goes through a SECURITY DEFINER RPC, save_recipe not exercised
-- by this suite) — same reset-role-for-a-direct-write technique
-- finalize_import_job.test.sql uses to backdate a timestamp.
select public.delete_recipe('20000000-0000-0000-0000-000000000001');
reset role;
insert into public.recipes (id, household_id, title, source_url, created_by)
values (
  '20000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Recipe A1 (re-imported)', 'https://example.test/a1', '11111111-1111-1111-1111-111111111111'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select lives_ok(
  $$ select public.restore_recipe('20000000-0000-0000-0000-000000000001') $$,
  'restore_recipe: does not raise when another active recipe already holds this source_url'
);
select is(
  (select source_url from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
  null,
  'restore_recipe: detaches source_url on collision instead of failing'
);
select is(
  (select source_url from public.recipes where id = '20000000-0000-0000-0000-000000000004'),
  'https://example.test/a1',
  'restore_recipe: the re-imported recipe keeps the source_url unchanged'
);

-- restore_recipe / no collision: A2 has no source_url at all, so
-- nothing to detach.
select public.delete_recipe('20000000-0000-0000-0000-000000000002');
select is(
  (select source_url is null from public.restore_recipe('20000000-0000-0000-0000-000000000002')),
  true,
  'restore_recipe: a recipe with no source_url is unaffected by the collision check'
);

-- permanently_delete_recipe. A2 is currently active at this point
-- (restored a few assertions up) — exercises the "exists but not
-- deleted" branch, distinct from "not found at all."
select throws_ok(
  $$ select public.permanently_delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'recipe is not deleted',
  'permanently_delete_recipe: rejects a recipe that is not currently deleted'
);

select public.delete_recipe('20000000-0000-0000-0000-000000000004');
select is(
  (select count(*)::int from public.permanently_delete_recipe('20000000-0000-0000-0000-000000000004')),
  1,
  'permanently_delete_recipe: succeeds once the recipe is deleted, returning one row'
);
select is(
  (select count(*)::int from public.recipes where id = '20000000-0000-0000-0000-000000000004'),
  0,
  'permanently_delete_recipe: the row is actually gone'
);
select is(
  (select count(*)::int from public.deleted_recipes where id = '20000000-0000-0000-0000-000000000004'),
  1,
  'permanently_delete_recipe: fires Phase 6''s existing hard-delete tombstone trigger'
);
select is(
  (select count(*)::int from public.permanently_delete_recipe('20000000-0000-0000-0000-000000000004')),
  0,
  'permanently_delete_recipe: a repeat call against an already-gone id is a safe no-op, not an error'
);

-- permanently_delete_recipe / TOCTOU (Codex review, PR #49): the
-- deleted-state check now lives in the DELETE's own WHERE clause, not a
-- separate earlier SELECT, precisely so a row that stopped being
-- deleted between "decide to delete" and "delete" can't be removed
-- anyway. True concurrent-session interleaving isn't expressible in
-- pgTAP's single-transaction model (see docs/current.md's own note on
-- this same limitation for Phase 11.5) — this instead proves the fixed
-- code path directly: delete, restore, then attempt permanent delete
-- again. The old implementation's separate SELECT would have raised the
-- same message here too (this exact sequence isn't itself the race),
-- but it confirms the rewritten atomic-DELETE version didn't regress
-- this case while closing the race a concurrent caller could hit.
select public.delete_recipe('20000000-0000-0000-0000-000000000002');
select public.restore_recipe('20000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.permanently_delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'recipe is not deleted',
  'permanently_delete_recipe: a restored recipe cannot be permanently deleted'
);

-- permanently_delete_recipe / import_jobs FK cleanup (Codex review, PR
-- #49): a recipe referenced by import_jobs.recipe_id or
-- duplicate_of_recipe_id (Phase 8 schema, plain FKs with no ON DELETE
-- clause) used to make this hard DELETE raise a foreign-key violation —
-- 20260811130000_recipe_lifecycle_security_fixes.sql sets both to ON
-- DELETE SET NULL. authenticated has no INSERT grant on recipes/
-- import_jobs (every write goes through a SECURITY DEFINER RPC), same
-- reset-role technique the source_url-collision fixture above uses.
reset role;
insert into public.recipes (id, household_id, title, created_by)
values (
  '20000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Recipe A5 (imported)', '11111111-1111-1111-1111-111111111111'
);
insert into public.import_jobs
  (id, household_id, created_by, source_url, normalized_url, status, recipe_id)
values (
  '30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'https://example.test/a5', 'example.test/a5',
  'complete', '20000000-0000-0000-0000-000000000006'
);
insert into public.import_jobs
  (id, household_id, created_by, source_url, normalized_url, status, duplicate_of_recipe_id)
values (
  '30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111', 'https://example.test/a5-again', 'example.test/a5-again',
  'complete', '20000000-0000-0000-0000-000000000006'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);
select public.delete_recipe('20000000-0000-0000-0000-000000000006');
select is(
  (select count(*)::int from public.permanently_delete_recipe('20000000-0000-0000-0000-000000000006')),
  1,
  'permanently_delete_recipe: succeeds for a recipe still referenced by import_jobs'
);
select is(
  (select recipe_id from public.import_jobs where id = '30000000-0000-0000-0000-000000000001'),
  null,
  'permanently_delete_recipe: nulls out import_jobs.recipe_id rather than leaving a dangling FK'
);
select is(
  (select duplicate_of_recipe_id from public.import_jobs where id = '30000000-0000-0000-0000-000000000002'),
  null,
  'permanently_delete_recipe: nulls out import_jobs.duplicate_of_recipe_id rather than leaving a dangling FK'
);

-- Cross-household rejection
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'recipe not found',
  'delete_recipe: rejects a recipe belonging to a different household'
);
select public.delete_recipe('20000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.restore_recipe('20000000-0000-0000-0000-000000000002') $$,
  'recipe not found or not deleted',
  'restore_recipe: cannot be used to reach into a different household''s recipe'
);
select throws_ok(
  $$ select public.permanently_delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'recipe not found',
  'permanently_delete_recipe: cannot be used to reach into a different household''s recipe'
);

-- Server authorization: a user with no household can't do anything here.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-5555-5555-555555555555', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.archive_recipe('20000000-0000-0000-0000-000000000002') $$,
  'caller does not belong to a household',
  'archive_recipe: rejects a caller with no household'
);
select throws_ok(
  $$ select public.delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'caller does not belong to a household',
  'delete_recipe: rejects a caller with no household'
);
select throws_ok(
  $$ select public.restore_recipe('20000000-0000-0000-0000-000000000002') $$,
  'caller does not belong to a household',
  'restore_recipe: rejects a caller with no household'
);
select throws_ok(
  $$ select public.permanently_delete_recipe('20000000-0000-0000-0000-000000000002') $$,
  'caller does not belong to a household',
  'permanently_delete_recipe: rejects a caller with no household'
);

select * from finish();

rollback;
