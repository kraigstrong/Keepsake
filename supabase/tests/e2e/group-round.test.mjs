// Group Help Me Choose, driven end to end by separately signed-in
// household members against local Supabase and the locally served
// select-candidates Edge Function — the nearest thing to two phones that
// runs without a device. pgTAP covers each RPC's rules in isolation; this
// covers what only shows up when real members take turns through the
// whole flow. Needs local Supabase running (`npm run db:start`, which
// also serves the Edge Functions); run with `npm run test:e2e`.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { currentWeekKey } from '../../../src/thisWeek/weekKey.ts';
import {
  adminClient,
  localSupabaseConfig,
  removeSeeded,
  rpc,
  rpcError,
  seedHousehold,
  startRound,
} from './fixture.mjs';

const HOUR_MS = 60 * 60 * 1000;

let config;
before(() => {
  config = localSupabaseConfig();
});
after(() => removeSeeded(config));

async function decisionAuthors(client, roundId) {
  const { data, error } = await client
    .from('selection_decisions')
    .select('user_id')
    .eq('round_id', roundId);
  if (error) throw new Error(`selection_decisions: ${error.message}`);
  return new Set(data.map((row) => row.user_id));
}

async function planRecipeIds(client) {
  const plan = await rpc(client, 'get_or_create_current_weekly_plan', {
    week_key_param: currentWeekKey(),
  });
  const planId = Array.isArray(plan) ? plan[0].id : plan.id;
  const { data, error } = await client
    .from('planning_entries')
    .select('recipe_id')
    .eq('weekly_plan_id', planId)
    .order('position');
  if (error) throw new Error(`planning_entries: ${error.message}`);
  return { planId, recipeIds: data.map((row) => row.recipe_id) };
}

function names(people) {
  return people.map((person) => person.display_name);
}

test('two members run a group round from start to This Week', async () => {
  const { members } = await seedHousehold(config, { memberNames: ['Alex', 'Blair', 'Casey'] });
  const { Alex: alex, Blair: blair, Casey: casey } = members;

  const { roundId, candidateCount } = await startRound(alex.client, {
    mode: 'group',
    participantUserIds: [blair.userId],
    targetCount: 4,
    closesAt: new Date(Date.now() + HOUR_MS).toISOString(),
  });
  assert.equal(candidateCount, 12);
  const round = { round_id: roundId };

  const alexView = await rpc(alex.client, 'get_selection_round', round);
  const blairView = await rpc(blair.client, 'get_selection_round', round);
  assert.equal(blairView.status, 'active');
  assert.equal(blairView.mode, 'group');
  assert.deepEqual(
    new Set(blairView.participants.map((p) => p.user_id)),
    new Set([alex.userId, blair.userId]),
  );
  const deck = alexView.candidates.map((c) => c.recipe_id);
  assert.deepEqual(
    blairView.candidates.map((c) => c.recipe_id),
    deck,
    'both participants swipe the same deck in the same order',
  );

  // Alex: yes to cards 0-4, no to the rest. Blair: yes to 0-2 and 5, no
  // to 3-4 and 6-8, and never reaches 9-11.
  for (const [i, recipeId] of deck.entries()) {
    await rpc(alex.client, 'record_selection_decision', {
      ...round,
      recipe_id: recipeId,
      decision: i < 5 ? 'yes' : 'no',
    });
  }
  const blairYes = new Set([0, 1, 2, 5]);
  for (const [i, recipeId] of deck.slice(0, 9).entries()) {
    await rpc(blair.client, 'record_selection_decision', {
      ...round,
      recipe_id: recipeId,
      decision: blairYes.has(i) ? 'yes' : 'no',
    });
  }

  assert.deepEqual(
    await decisionAuthors(blair.client, roundId),
    new Set([blair.userId]),
    'mid-round, a participant sees only their own ballot',
  );
  assert.match(
    await rpcError(blair.client, 'get_selection_round_results', round),
    /not available yet/,
  );

  const caseyView = await rpc(casey.client, 'get_selection_round', round);
  assert.equal(caseyView.id, roundId, 'an uninvited member can still see the round');
  const progress = Object.fromEntries(
    caseyView.participants.map((p) => [
      p.display_name,
      { decided: p.decided_count, yes: p.yes_count, finished: p.completed_at !== null },
    ]),
  );
  assert.deepEqual(
    progress,
    {
      Alex: { decided: 12, yes: 5, finished: false },
      Blair: { decided: 9, yes: 4, finished: false },
    },
    'mid-round progress is visible to the whole household',
  );
  assert.match(
    await rpcError(casey.client, 'record_selection_decision', {
      ...round,
      recipe_id: deck[0],
      decision: 'yes',
    }),
    /not a participant/,
  );
  assert.match(
    await rpcError(casey.client, 'finish_selection_participation', round),
    /not a participant/,
  );

  await rpc(alex.client, 'finish_selection_participation', round);
  await rpc(blair.client, 'finish_selection_participation', round);

  assert.match(
    await rpcError(blair.client, 'close_selection_round', round),
    /only the round creator/,
  );
  await rpc(alex.client, 'close_selection_round', round);

  const alexResults = await rpc(alex.client, 'get_selection_round_results', round);
  const blairResults = await rpc(blair.client, 'get_selection_round_results', round);
  assert.deepEqual(blairResults, alexResults, 'everyone sees the same results');
  assert.equal(alexResults.completed_participant_count, 2);

  const result = new Map(alexResults.candidates.map((c) => [c.recipe_id, c]));
  for (const i of [0, 1, 2]) {
    const row = result.get(deck[i]);
    assert.equal(row.category, 'unanimous', `card ${i}`);
    assert.deepEqual(names(row.chosen_by), ['Alex', 'Blair'], `card ${i}`);
  }
  for (const i of [3, 4]) {
    const row = result.get(deck[i]);
    assert.equal(row.category, 'mixed', `card ${i}`);
    assert.deepEqual(names(row.chosen_by), ['Alex'], `card ${i}`);
    assert.deepEqual(names(row.passed_by), ['Blair'], `card ${i}`);
  }
  assert.deepEqual(names(result.get(deck[5]).chosen_by), ['Blair']);
  assert.deepEqual(names(result.get(deck[5]).passed_by), ['Alex']);
  for (const i of [9, 10, 11]) {
    assert.deepEqual(
      names(result.get(deck[i]).passed_by),
      ['Alex'],
      `card ${i}: Blair never reached it, so must not be named as passing`,
    );
  }

  assert.deepEqual(
    await decisionAuthors(blair.client, roundId),
    new Set([alex.userId, blair.userId]),
    'ballots are revealed once the round closes',
  );
  assert.match(
    await rpcError(blair.client, 'record_selection_decision', {
      ...round,
      recipe_id: deck[9],
      decision: 'yes',
    }),
    /not active/,
  );

  // Blair, not the creator, adds the unanimous picks to This Week.
  const unanimous = deck.slice(0, 3);
  const { planId } = await planRecipeIds(blair.client);
  const selections = unanimous.map((recipeId) => ({ recipe_id: recipeId, multiplier: 1 }));
  await rpc(blair.client, 'apply_selection_round', {
    ...round,
    weekly_plan_id: planId,
    selections,
  });

  const afterApply = await planRecipeIds(alex.client);
  assert.equal(afterApply.planId, planId, 'both members share one weekly plan');
  assert.deepEqual(afterApply.recipeIds, unanimous, "the picks land in Alex's This Week");

  await rpc(alex.client, 'apply_selection_round', {
    ...round,
    weekly_plan_id: planId,
    selections,
  });
  assert.deepEqual(
    (await planRecipeIds(alex.client)).recipeIds,
    unanimous,
    'applying again adds nothing',
  );
  assert.equal((await rpc(casey.client, 'get_selection_round', round)).status, 'applied');
});

test('an unfinished participant is left out when the creator closes early', async () => {
  const { members } = await seedHousehold(config, { memberNames: ['Alex', 'Blair'] });
  const { Alex: alex, Blair: blair } = members;

  const { roundId } = await startRound(alex.client, {
    mode: 'group',
    participantUserIds: [blair.userId],
    closesAt: new Date(Date.now() + HOUR_MS).toISOString(),
  });
  const round = { round_id: roundId };
  const deck = (await rpc(alex.client, 'get_selection_round', round)).candidates.map(
    (c) => c.recipe_id,
  );

  await rpc(alex.client, 'record_selection_decision', {
    ...round,
    recipe_id: deck[0],
    decision: 'yes',
  });
  await rpc(alex.client, 'finish_selection_participation', round);
  await rpc(blair.client, 'record_selection_decision', {
    ...round,
    recipe_id: deck[0],
    decision: 'yes',
  });
  await rpc(alex.client, 'close_selection_round', round);

  const results = await rpc(blair.client, 'get_selection_round_results', round);
  assert.equal(results.completed_participant_count, 1);
  const first = results.candidates.find((c) => c.recipe_id === deck[0]);
  assert.deepEqual(names(first.chosen_by), ['Alex'], "Blair's unfinished ballot does not count");
  assert.equal(first.category, 'unanimous');
});

test('the deadline closes the round on the next read, for anyone', async () => {
  const { members } = await seedHousehold(config, { memberNames: ['Alex', 'Blair'] });
  const { Alex: alex, Blair: blair } = members;

  const { roundId } = await startRound(alex.client, {
    mode: 'group',
    participantUserIds: [blair.userId],
    closesAt: new Date(Date.now() + HOUR_MS).toISOString(),
  });
  const round = { round_id: roundId };
  assert.equal((await rpc(blair.client, 'get_selection_round', round)).status, 'active');

  // Move the deadline into the past directly, rather than racing a short
  // one against a cold Edge Function call (Codex, PR #245).
  const { error } = await adminClient(config)
    .from('selection_rounds')
    .update({ closes_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', roundId);
  assert.equal(error, null);

  const closed = await rpc(blair.client, 'get_selection_round', round);
  assert.equal(closed.status, 'ready_for_review');
  assert.ok(closed.revealed_at, 'auto-close reveals ballots exactly as a manual close does');
  await rpc(blair.client, 'get_selection_round_results', round);
});

test('a group round cannot include someone from another household', async () => {
  const home = await seedHousehold(config, { memberNames: ['Alex'] });
  const away = await seedHousehold(config, { memberNames: ['Drew'], recipeCount: 0 });

  await assert.rejects(
    startRound(home.members.Alex.client, {
      mode: 'group',
      participantUserIds: [away.members.Drew.userId],
      closesAt: new Date(Date.now() + HOUR_MS).toISOString(),
    }),
    /not a member of the caller's household/,
  );
  const { data, error } = await home.members.Alex.client
    .from('selection_rounds')
    .select('id')
    .in('status', ['pending_candidates', 'active', 'ready_for_review']);
  assert.equal(error, null);
  assert.deepEqual(data, [], 'the rejected start leaves no round behind');
});
