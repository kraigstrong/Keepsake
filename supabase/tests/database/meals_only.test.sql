begin;
select plan(18);

insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111', 'meals-a@example.test'),
 ('33333333-3333-3333-3333-333333333333', 'meals-b@example.test');
insert into public.households (id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
insert into public.household_membership (household_id, user_id) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333');

set local role authenticated;
select throws_ok($$select public.create_selection_round_with_filters('solo', '{}', 4, null, true)$$,
 'caller does not belong to a household', 'filtered round rejects userless callers');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

create temporary table meal as select * from public.save_recipe('{"title":"Pasta","isMeal":true}');
create temporary table dessert as select * from public.save_recipe(jsonb_build_object(
 'title', 'Cake', 'categoryIds', jsonb_build_array((select id from public.categories where group_name = 'dish_type' and value = 'Dessert'))));
select is((select is_meal from meal), true, 'explicit meal saved');
select is((select is_meal from dessert), false, 'legacy creates with Dessert are non-meals');
select is((select is_meal from public.save_recipe('{"title":"Legacy soup"}')), true, 'legacy create without Dessert defaults to meal');
select is((select (snapshot->>'isMeal')::boolean from public.recipe_versions where recipe_id = (select id from dessert)), false, 'snapshot stores the effective classification');
select is((select is_meal from public.save_recipe(jsonb_build_object('id', (select id from dessert), 'baseVersion', 1, 'title', 'Cake edited'))), false, 'legacy edits preserve explicit classification');
select is((select is_meal from public.save_recipe(jsonb_build_object('id', (select id from dessert), 'baseVersion', 2, 'title', 'Cake meal', 'isMeal', true))), true, 'classification can be corrected independently of categories');
select is((select is_meal from public.restore_recipe_version((select id from public.recipe_versions where recipe_id = (select id from dessert) and version_number = 1))), false, 'restoring a version restores its classification');
select throws_ok($$select public.save_recipe('{"title":"Bad","isMeal":"false"}')$$, 'isMeal must be a boolean', 'reject string classification');
select throws_ok($$select public.save_recipe('{"title":"Bad","isMeal":null}')$$, 'isMeal must be a boolean', 'reject null classification');
select is((select count(*)::int from public.recipes where title = 'Bad'), 0, 'invalid classification writes nothing');

create temporary table claim as select * from public.create_selection_round_with_filters('solo', '{}', 4, null, true);
select is((select meals_only from public.selection_rounds where id = (select round_id from claim)), true, 'round stores Meals only for refills/resume');
create temporary table renewed as select * from public.create_selection_round_with_filters('solo', '{}', 4, null, false);
select is((select meals_only from public.selection_rounds where id = (select round_id from renewed)), false, 'pending adoption uses the new claimed choice');
select isnt((select claim_token from claim), (select claim_token from renewed), 'changing pending choice rotates the claim fence');
select throws_ok($$select public.finalize_selection_round_candidates((select round_id from claim), (select claim_token from claim), jsonb_build_array(jsonb_build_object('recipe_id', (select id from meal), 'score', 1, 'reason_codes', '[]'::jsonb)), 'heuristic-v1')$$,
 'selection round not found, already finalized, or claim no longer held', 'old claim cannot finalize after preference changed');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.recipes where id = (select id from dessert)), 0, 'classification does not expose another household recipe');
select throws_ok($$select public.save_recipe(jsonb_build_object('id', (select id from dessert), 'baseVersion', 4, 'title', 'Intrusion', 'isMeal', true))$$,
 'recipe not found', 'cannot change another household classification');
select is((select count(*)::int from public.selection_rounds where id = (select round_id from claim)), 0, 'round filter is household scoped');
select * from finish();
rollback;
