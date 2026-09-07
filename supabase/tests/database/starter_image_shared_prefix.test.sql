-- ADR-0029. The starter images live once, under a shared "starters/"
-- prefix, in a bucket whose every other object is household-scoped.
-- Two things have to hold for that to be safe: anyone signed in can
-- read it, and nobody signed in can write it.

begin;

select plan(23);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'mallory@example.test');

insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Alice A'),
  ('22222222-2222-2222-2222-222222222222', 'Mallory M');

insert into public.households (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

insert into public.household_membership (household_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

-- Placed with the service role, the way the real ones are
-- (docs/deploying-starter-images.md) -- there is deliberately no policy
-- that would let an authenticated caller do this.
insert into storage.objects (bucket_id, name, owner)
values ('recipe-images', 'starters/sheet-pan-chicken.jpg', null);

insert into storage.objects (bucket_id, name, owner)
values ('recipe-images', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/private.jpg', null);

-- Stands in for an operator slip: something under the prefix that the
-- app can never reference, because no valid key expands to it.
insert into storage.objects (bucket_id, name, owner)
values ('recipe-images', 'starters/operator-notes.txt', null);

-- ---------- the path helper cannot escape the prefix ----------

select is(public.starter_image_path('sheet-pan-chicken'), 'starters/sheet-pan-chicken.jpg',
  'a well-formed key expands under the shared prefix');
select is(public.starter_image_path(null), null,
  'an absent key yields no path');
select is(public.starter_image_path(''), null,
  'an empty key yields no path');
select is(public.starter_image_path('../aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/private'), null,
  'a traversal attempt yields no path, not a path out of the prefix');
select is(public.starter_image_path('a/b'), null,
  'a key containing a separator yields no path');
select is(public.starter_image_path('Sheet-Pan'), null,
  'an uppercase key is rejected rather than silently lowercased');
select is(public.starter_image_path(repeat('a', 65)), null,
  'an over-long key yields no path');
select is(public.starter_image_path(repeat('a', 64)), 'starters/' || repeat('a', 64) || '.jpg',
  'a key at the length bound is still accepted');

-- ---------- any signed-in user can read the shared prefix ----------

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'),
  1::bigint,
  'a household member can read a shared starter image');

select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

-- The point of the shared prefix: it is not scoped to household A, so a
-- member of B sees it too. This is the widening ADR-0029 accepts.
select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'),
  1::bigint,
  'a member of a different household can read the same starter image');

-- ...while household isolation is untouched for everything else.
select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images'
     and name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/private.jpg'),
  0::bigint,
  'the shared prefix does not open up another household''s own images');

-- ---------- nobody signed in can write the shared prefix ----------
-- No write policy was added. These fail because safe_uuid('starters') is
-- null, so every existing insert/update/delete policy evaluates false --
-- read-only by construction, not by convention.

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('recipe-images', 'starters/mallory.jpg', '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'a signed-in caller cannot add an object to the shared prefix');

select lives_ok(
  $$update storage.objects set name = 'starters/hijacked.jpg'
    where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'$$,
  'an update against the shared prefix raises nothing -- RLS filters the rows away');

select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'),
  1::bigint,
  'and renames nothing: the update above matched no rows');

-- Not our policy doing the refusing here, and the test says so rather
-- than taking credit for it: storage ships a protect_delete() trigger
-- that blocks every direct SQL delete from storage.objects whatever RLS
-- says. Which means a delete at this layer cannot demonstrate anything
-- about the prefix, and the assertion after it is the one that does.
select throws_ok(
  $$delete from storage.objects
    where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'$$,
  '42501',
  null,
  'storage refuses direct SQL deletes regardless of policy');

select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'),
  1::bigint,
  'and the shared starter image is still there afterwards');

-- The actual proof, stated as the predicate rather than inferred from an
-- operation: this expression is what all four of the bucket's existing
-- write policies evaluate for a "starters/..." key, and it is false. No
-- write policy can match the prefix, so none had to be excluded.
select ok(
  not public.is_household_member(public.safe_uuid('starters')),
  'every existing write policy''s predicate is false for the shared prefix');

-- A household id can never collide with the prefix, because ids are uuids.
select is(public.safe_uuid('starters'), null,
  'the literal prefix is not a uuid, which is why the write policies cannot match it');

-- ---------- the seeding RPC expands a key, and never a path ----------
-- The boundary this protects is 20260901100000's allowlist: the client
-- supplies a key, the RPC builds the path, so hero_image_path cannot be
-- aimed anywhere but the shared prefix.

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- Seeded as household B's member. Either household would do -- the
-- fixture above inserts storage objects, not recipes, so neither has any
-- and the RPC's emptiness guard is satisfied by both.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ select * from public.seed_starter_recipes(jsonb_build_object('recipes', jsonb_build_array(
      jsonb_build_object(
        'title', 'Keyed Starter', 'activeTimeMinutes', 10, 'totalTimeMinutes', 20,
        'yieldText', 'Serves 4', 'servingsCount', 4, 'permanentNotes', 'A headnote.',
        'sourceAttribution', 'Keepsake starter recipe',
        'imageKey', 'sheet-pan-chicken',
        'tags', '[]'::jsonb, 'categories', '[]'::jsonb,
        'ingredientSections', '[]'::jsonb, 'instructionSections', '[]'::jsonb
      ),
      jsonb_build_object(
        'title', 'Escaping Starter', 'activeTimeMinutes', 10, 'totalTimeMinutes', 20,
        'yieldText', 'Serves 4', 'servingsCount', 4, 'permanentNotes', 'A headnote.',
        'sourceAttribution', 'Keepsake starter recipe',
        'imageKey', '../aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/private',
        'tags', '[]'::jsonb, 'categories', '[]'::jsonb,
        'ingredientSections', '[]'::jsonb, 'instructionSections', '[]'::jsonb
      )
    ))) $$,
  'seeding accepts an image key alongside the recipe');

select is(
  (select hero_image_path from public.recipes where title = 'Keyed Starter'),
  'starters/sheet-pan-chicken.jpg',
  'a valid key becomes a path under the shared prefix');

-- The whole point of expanding server-side: a caller supplying something
-- path-shaped gets no image, not an image belonging to someone else.
select is(
  (select hero_image_path from public.recipes where title = 'Escaping Starter'),
  null,
  'a key that tries to escape the prefix yields no path at all');

-- The policy grants exactly what starter_image_path can produce, so an
-- object placed under the prefix by an operator slip is not
-- world-readable just for being there.
select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/operator-notes.txt'),
  0::bigint,
  'a non-conforming object under the prefix is not readable');

select is(
  (select count(*) from storage.objects
   where bucket_id = 'recipe-images' and name = 'starters/sheet-pan-chicken.jpg'),
  1::bigint,
  'while a conforming one still is');

select * from finish();
rollback;
