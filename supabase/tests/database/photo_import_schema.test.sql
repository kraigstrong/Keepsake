-- Phase 10 (ADR-0017): create_import_job's new photo_path parameter and
-- save_recipe's new originalPhotoPath field. Mirrors import_jobs.test.sql's
-- fixture/pattern.

begin;

select plan(9);

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'alice@example.test');

insert into public.households (id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

insert into public.household_membership (household_id, user_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- create_import_job: photo-sourced jobs

create temporary table alice_photo_job as
select * from public.create_import_job(photo_path := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg');

select is(
  (select status from alice_photo_job),
  'processing',
  'create_import_job(photo_path): starts in processing status'
);

select is(
  (select source_url from alice_photo_job),
  null::text,
  'create_import_job(photo_path): source_url stays null for a photo-sourced job'
);

select is(
  (select photo_path from alice_photo_job),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg',
  'create_import_job(photo_path): photo_path recorded on the job'
);

select throws_ok(
  $$ select public.create_import_job('https://example.test/x', 'https://example.test/x', null, 'a/b.jpg') $$,
  'exactly one of source_url or photo_path is required',
  'create_import_job: rejects both source_url and photo_path being set'
);

select throws_ok(
  $$ select public.create_import_job() $$,
  'exactly one of source_url or photo_path is required',
  'create_import_job: rejects neither source_url nor photo_path being set'
);

reset role;
select throws_ok(
  format(
    $$ insert into public.import_jobs (household_id, created_by, source_url, normalized_url, photo_path)
       values (%L, %L, 'https://example.test/x', 'https://example.test/x', 'a/b.jpg') $$,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'
  ),
  'new row for relation "import_jobs" violates check constraint "import_jobs_source_url_xor_photo_path"',
  'import_jobs: the xor check constraint holds even bypassing the RPC entirely (defense in depth)'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text,
  true
);

-- save_recipe: originalPhotoPath on create, immutable on edit

create temporary table alice_photo_recipe as
select * from public.save_recipe(
  jsonb_build_object(
    'title', 'Grandma''s Recipe Card',
    'originalPhotoPath', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg',
    'tags', jsonb_build_array(),
    'categoryIds', jsonb_build_array(),
    'ingredientSections', jsonb_build_array(),
    'instructionSections', jsonb_build_array()
  )
);

select is(
  (select original_photo_path from alice_photo_recipe),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg',
  'save_recipe: originalPhotoPath is persisted on create'
);

select * from public.save_recipe(
  jsonb_build_object(
    'id', (select id from alice_photo_recipe),
    'baseVersion', (select version from alice_photo_recipe),
    'title', 'Grandma''s Recipe Card (edited title)',
    'originalPhotoPath', 'someone-tried-to-overwrite-it.jpg',
    'tags', jsonb_build_array(),
    'categoryIds', jsonb_build_array(),
    'ingredientSections', jsonb_build_array(),
    'instructionSections', jsonb_build_array()
  )
);

select is(
  (select original_photo_path from public.recipes where id = (select id from alice_photo_recipe)),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/originals/one.jpg',
  'save_recipe: original_photo_path is immutable on edit, even if the payload carries a different value'
);

select is(
  (select title from public.recipes where id = (select id from alice_photo_recipe)),
  'Grandma''s Recipe Card (edited title)',
  'save_recipe: the edit itself still applies normally to other fields'
);

select * from finish();

rollback;
