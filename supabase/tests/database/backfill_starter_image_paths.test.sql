-- The backfill in 20260908120000 is a one-shot statement, so it has
-- already run by the time any test sees the database. What is testable,
-- and worth testing, is that its predicate is the right one — re-running
-- it against fixtures proves the guards hold.

begin;

select plan(6);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.test');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Alice A');
insert into public.households (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into public.household_membership (household_id, user_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

-- Four rows standing in for the states a live library can be in.
insert into public.recipes
  (id, household_id, title, created_by, source_attribution, hero_image_path, updated_at)
values
  -- Seeded before ADR-0029: the row this exists for.
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Bolognese', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', null, '2026-01-01T00:00:00Z'),
  -- Seeded, then given the owner's own photo. Must not be overwritten.
  ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Bolognese', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/mine.jpg',
   '2026-01-01T00:00:00Z'),
  -- The user's own recipe that happens to share the title.
  ('c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Weeknight Bolognese', '11111111-1111-1111-1111-111111111111',
   null, null, '2026-01-01T00:00:00Z'),
  -- A seeded recipe with no image of its own yet.
  ('c0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Buttermilk Pancakes', '11111111-1111-1111-1111-111111111111',
   'Keepsake starter recipe', null, '2026-01-01T00:00:00Z');

update public.recipes
set hero_image_path = public.starter_image_path('weeknight-bolognese'),
    updated_at = now()
where source_attribution = 'Keepsake starter recipe'
  and title = 'Weeknight Bolognese'
  and hero_image_path is null;

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000001'),
  'starters/weeknight-bolognese.jpg',
  'a household that seeded before this existed gets the shared image');

-- Without this the change never reaches a device: recipes.updated_at has
-- no trigger, and sync pages by it.
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
  'and that row is not touched at all, so it costs no needless resync');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000003'),
  null,
  'a recipe the user wrote themselves is not claimed by the title alone');

select is(
  (select hero_image_path from public.recipes where id = 'c0000000-0000-0000-0000-000000000004'),
  null,
  'a starter with no uploaded image stays without one');

select * from finish();
rollback;
