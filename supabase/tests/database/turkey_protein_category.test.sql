begin;
select plan(6);

select is((select count(*)::int from public.categories where group_name = 'protein' and value = 'Turkey'), 1, 'Turkey is seeded exactly once as a protein');
select is((select count(*)::int from public.categories where group_name = 'protein' and value in ('Chicken', 'Beef', 'Pork', 'Seafood', 'Vegetarian')), 5, 'existing protein categories remain intact');

insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111', 'turkey-a@example.test'),
 ('33333333-3333-3333-3333-333333333333', 'turkey-b@example.test');
insert into public.households (id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into public.household_membership (household_id, user_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
create temporary table turkey_recipe as select * from public.save_recipe(jsonb_build_object(
 'title', 'Turkey meatballs', 'isMeal', true,
 'categoryIds', jsonb_build_array((select id from public.categories where group_name = 'protein' and value = 'Turkey'))));
select is((select c.value from public.recipe_categories rc join public.categories c on c.id = rc.category_id where rc.recipe_id = (select id from turkey_recipe)), 'Turkey', 'Turkey assignment survives save and read');
select lives_ok($$select public.save_recipe(jsonb_build_object('id', (select id from turkey_recipe), 'baseVersion', 1, 'title', 'Turkey meatballs edited', 'isMeal', true, 'categoryIds', jsonb_build_array((select id from public.categories where group_name = 'protein' and value = 'Turkey'))))$$, 'existing recipe can retain Turkey on edit');
select is((select (snapshot->'categoryIds')->>0 from public.recipe_versions where recipe_id = (select id from turkey_recipe) and version_number = 2), (select id::text from public.categories where group_name = 'protein' and value = 'Turkey'), 'edited version retains the Turkey assignment');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.recipe_categories where recipe_id = (select id from turkey_recipe)), 0, 'global Turkey taxonomy does not expose household recipe assignments');
select * from finish();
rollback;
