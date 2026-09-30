-- 20260929120000 is one-shot, like 20260908120000: it has already run by
-- the time any test sees the database, so this re-runs its statements
-- against fixtures to prove the guards hold.

begin;

select plan(9);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Alice A');
insert into public.households (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.household_membership (household_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

insert into public.recipes
  (id, household_id, title, created_by, source_attribution, hero_image_path, updated_at)
values
  -- Seeded with no image: the row the first statement exists for.
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Buttermilk Pancakes', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', null, '2026-01-01T00:00:00Z'),
  -- Seeded, then given the owner's own photo. Must not be overwritten.
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Skillet Mac and Cheese', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mine.jpg',
   '2026-01-01T00:00:00Z'),
  -- The user's own recipe that happens to share a starter's title.
  ('c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Buttermilk Pancakes', '11111111-1111-1111-1111-111111111111',
   null, null, '2026-01-01T00:00:00Z'),
  -- Bolognese on the replaced image: the row the second statement exists for.
  ('c0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Bolognese', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', 'starters/weeknight-bolognese.jpg',
   '2026-01-01T00:00:00Z'),
  -- A seeded Bolognese the owner renamed: still showing the old photo.
  ('c0000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Nonna''s Bolognese', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', 'starters/weeknight-bolognese.jpg',
   '2026-01-01T00:00:00Z');

update public.recipes as r
set hero_image_path = public.starter_image_path(k.image_key),
    updated_at = now()
from (values
  ('Sheet-Pan Chicken Thighs with Potatoes and Lemon', 'sheet-pan-chicken-thighs'),
  ('Weeknight Bolognese', 'weeknight-bolognese-v2'),
  ('Ground Beef Tacos with Quick Cabbage Slaw', 'ground-beef-tacos'),
  ('Garlic Shrimp and Broccoli Stir-Fry', 'garlic-shrimp-stir-fry'),
  ('Slow Cooker Pulled Pork', 'slow-cooker-pulled-pork'),
  ('Black Bean and Sweet Potato Chili', 'black-bean-sweet-potato-chili'),
  ('Skillet Mac and Cheese', 'skillet-mac-and-cheese'),
  ('Buttermilk Pancakes', 'buttermilk-pancakes'),
  ('Brown Butter Chocolate Chip Cookies', 'brown-butter-chocolate-chip-cookies'),
  ('Grilled Lemon-Herb Chicken', 'grilled-lemon-herb-chicken')
) as k(title, image_key)
where r.source_attribution = 'Keepsake starter recipe'
  and r.title = k.title
  and r.hero_image_path is null;

update public.recipes
set hero_image_path = public.starter_image_path('weeknight-bolognese-v2'),
    updated_at = now()
where hero_image_path = 'starters/weeknight-bolognese.jpg';

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000001'),
  'starters/buttermilk-pancakes.jpg',
  'a seeded starter with no image gets its shared image');

-- recipes.updated_at has no trigger and sync pages by it.
select ok(
  (select updated_at from public.recipes where id = 'c0000000-0000-0000-0000-000000000001')
    > '2026-01-01T00:00:00Z'::timestamptz,
  'and its updated_at moves, so sync will actually fetch it');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000002'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mine.jpg',
  'a photo the owner chose themselves is left alone');

select is(
  (select updated_at from public.recipes where id = 'c0000000-0000-0000-0000-000000000002'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'and that row is not touched at all');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000003'),
  null,
  'a recipe the user wrote themselves is not claimed by the title alone');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000004'),
  'starters/weeknight-bolognese-v2.jpg',
  'a Bolognese on the replaced image moves to the new key');

select ok(
  (select updated_at from public.recipes where id = 'c0000000-0000-0000-0000-000000000004')
    > '2026-01-01T00:00:00Z'::timestamptz,
  'and its updated_at moves too');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000005'),
  'starters/weeknight-bolognese-v2.jpg',
  'so does one the owner renamed, since the path alone decides');

-- A key starter_image_path rejects expands to null, which the updates
-- above would write without complaint.
select is(
  (select count(*)::int from (values
    ('sheet-pan-chicken-thighs'), ('weeknight-bolognese-v2'), ('ground-beef-tacos'),
    ('garlic-shrimp-stir-fry'), ('slow-cooker-pulled-pork'),
    ('black-bean-sweet-potato-chili'), ('skillet-mac-and-cheese'),
    ('buttermilk-pancakes'), ('brown-butter-chocolate-chip-cookies'),
    ('grilled-lemon-herb-chicken')) as k(key)
   where public.starter_image_path(k.key) is not null),
  10,
  'every key expands to a path');

select * from finish();
rollback;
