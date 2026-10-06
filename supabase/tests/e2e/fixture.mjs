// Multi-user fixture for the end-to-end suites in this directory. Every
// user is a real auth account signed in through the anon key, so RLS and
// the RPCs' own household re-derivation apply exactly as they do for the
// app. The service-role client is used only to create accounts and to
// step around invitation rate limits — never to read or write app data
// on a member's behalf.
//
// Local only: the config comes from `supabase status`, and anything that
// isn't a loopback host is refused, because client.env points at the one
// hosted project real accounts live in.

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function localSupabaseConfig() {
  const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const vars = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match) vars[match[1]] = match[2];
  }
  if (!vars.API_URL || !vars.ANON_KEY || !vars.SERVICE_ROLE_KEY) {
    throw new Error('Local Supabase is not running — start it with `npm run db:start`.');
  }
  const { hostname } = new URL(vars.API_URL);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run against non-local Supabase host "${hostname}".`);
  }
  return { url: vars.API_URL, anonKey: vars.ANON_KEY, serviceRoleKey: vars.SERVICE_ROLE_KEY };
}

// Everything seedHousehold creates, so removeSeeded can take it away
// again: pgTAP's whole-table assertions assume a database holding only
// their own fixtures.
const seeded = { householdIds: [], userIds: [] };

function statelessClient(url, key) {
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Throws with the RPC's own message, so a failing step names the rule that fired. */
export async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

/** Resolves to the error message, or throws if the call unexpectedly succeeded. */
export async function rpcError(client, name, args) {
  const { error } = await client.rpc(name, args);
  if (!error) throw new Error(`${name} succeeded but was expected to fail`);
  return error.message;
}

const RECIPE_TITLES = [
  'Herb Roast Chicken',
  'Weeknight Pasta',
  'Black Bean Tacos',
  'Miso Salmon',
  'Beef and Broccoli',
  'Lentil Soup',
  'Shrimp Fried Rice',
  'Turkey Chili',
  'Margherita Flatbread',
  'Chickpea Curry',
  'Pork Carnitas',
  'Lemon Orzo',
  'Thai Basil Chicken',
  'Mushroom Risotto',
  'Fish Tacos',
  'Sheet-Pan Gnocchi',
];

const PROTEIN_ROTATION = ['Chicken', 'Beef', 'Seafood', 'Vegetarian', 'Pork', 'Turkey'];

/**
 * A household of `memberNames.length` signed-in members (the first one
 * creates it, the rest join by invitation) plus a recipe library big
 * enough for a default 12-card deck. Each call makes fresh accounts, so
 * runs never collide and no reset is needed between them.
 */
export async function seedHousehold(config, { memberNames, recipeCount = 16 }) {
  const admin = statelessClient(config.url, config.serviceRoleKey);
  const runId = randomBytes(4).toString('hex');

  const members = [];
  for (const name of memberNames) {
    const email = `${name.toLowerCase()}-${runId}@group-e2e.test`;
    const password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${name}: ${error.message}`);
    seeded.userIds.push(data.user.id);

    const client = statelessClient(config.url, config.anonKey);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn ${name}: ${signInError.message}`);

    const { error: profileError } = await client
      .from('profiles')
      .insert({ id: data.user.id, display_name: name });
    if (profileError) throw new Error(`profile ${name}: ${profileError.message}`);

    members.push({ name, email, password, userId: data.user.id, client });
  }

  const [owner, ...joiners] = members;
  const household = await rpc(owner.client, 'create_household');
  const householdId = Array.isArray(household) ? household[0].id : household.id;
  seeded.householdIds.push(householdId);

  for (const joiner of joiners) {
    // create_invitation allows one per household per 30s. Ageing the
    // previous invitation is quicker than waiting it out, and the join
    // itself still runs through the real accept path.
    await admin
      .from('invitations')
      .update({ created_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('household_id', householdId);
    const invitation = await rpc(owner.client, 'create_invitation');
    const token = Array.isArray(invitation) ? invitation[0].token : invitation.token;
    await rpc(joiner.client, 'accept_invitation', { raw_token: token });
  }

  const { data: categories, error: categoriesError } = await owner.client
    .from('categories')
    .select('id, group_name, value')
    .eq('group_name', 'protein');
  if (categoriesError) throw new Error(`categories: ${categoriesError.message}`);
  const proteinIds = new Map(categories.map((c) => [c.value, c.id]));

  const recipeIds = [];
  for (let i = 0; i < recipeCount; i += 1) {
    const title = RECIPE_TITLES[i % RECIPE_TITLES.length];
    const proteinId = proteinIds.get(PROTEIN_ROTATION[i % PROTEIN_ROTATION.length]);
    const saved = await rpc(owner.client, 'save_recipe', {
      payload: {
        title: i < RECIPE_TITLES.length ? title : `${title} ${i + 1}`,
        isMeal: true,
        totalTimeMinutes: 20 + (i % 4) * 10,
        servingsCount: 4,
        tags: [i % 2 === 0 ? 'weeknight' : 'weekend'],
        categoryIds: proteinId ? [proteinId] : [],
        ingredientSections: [{ title: null, lines: ['1 lb main ingredient', '2 cloves garlic'] }],
        instructionSections: [{ title: null, lines: ['Cook it.', 'Serve it.'] }],
      },
    });
    recipeIds.push(Array.isArray(saved) ? saved[0].id : saved.id);
  }

  return {
    runId,
    householdId,
    recipeIds,
    members: Object.fromEntries(members.map((m) => [m.name, m])),
  };
}

/** Deletes every household (and so, by cascade, its data) and account seeded in this process. */
export async function removeSeeded(config) {
  const admin = statelessClient(config.url, config.serviceRoleKey);
  if (seeded.householdIds.length > 0) {
    // Recipes first, as delete_own_account does: cascading into them from
    // the household would tombstone them against a half-deleted household.
    const { error: recipesError } = await admin
      .from('recipes')
      .delete()
      .in('household_id', seeded.householdIds);
    if (recipesError) throw new Error(`remove recipes: ${recipesError.message}`);
    const { error } = await admin.from('households').delete().in('id', seeded.householdIds);
    if (error) throw new Error(`remove households: ${error.message}`);
  }
  for (const userId of seeded.userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(`remove user: ${error.message}`);
  }
  seeded.householdIds.length = 0;
  seeded.userIds.length = 0;
}

/** Starts a round through the real select-candidates Edge Function, as the app does. */
export async function startRound(client, body) {
  const { data, error } = await client.functions.invoke('select-candidates', { body });
  if (error) {
    let detail = error.message;
    try {
      detail = (await error.context.json()).error ?? detail;
    } catch {
      // not a JSON body — keep the transport message
    }
    throw new Error(`select-candidates: ${detail}`);
  }
  return data;
}
