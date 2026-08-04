#!/usr/bin/env node
// Dev-only tooling: creates (or rotates the password of) a real staging
// Supabase account for automated UI walkthroughs, so an agent/script can
// sign in via the app's own signInWithPassword path without a human ever
// typing or sharing a password. Uses the service-role key (server.env)
// to call the Admin API directly — never touches the sign-in UI.
//
// The generated password is never logged or printed anywhere by this
// script; it's written straight from memory into .env.local as
// EXPO_PUBLIC_DEV_TEST_EMAIL / EXPO_PUBLIC_DEV_TEST_PASSWORD, which
// SessionProvider's dev-only auto-sign-in reads (see SessionProvider.tsx —
// gated on __DEV__, so it's inert in any real build).
//
// Usage: node scripts/create-dev-test-account.mjs

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_EMAIL = 'dev-test@keepsake.local';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath) {
  const vars = {};
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

const clientEnv = loadEnvFile(path.join(rootDir, 'client.env'));
const serverEnv = loadEnvFile(path.join(rootDir, 'server.env'));

const supabaseUrl = clientEnv.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL (client.env) or SUPABASE_SERVICE_ROLE_KEY (server.env).',
  );
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const password = randomBytes(24).toString('base64url');

async function findExistingUserId() {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email === TEST_EMAIL);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
}

const existingUserId = await findExistingUserId();

if (existingUserId) {
  const { error } = await admin.auth.admin.updateUserById(existingUserId, { password });
  if (error) throw error;
} else {
  const { error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password,
    email_confirm: true,
  });
  if (error) throw error;
}

const envLocalPath = path.join(rootDir, '.env.local');
let existingLines = [];
try {
  existingLines = readFileSync(envLocalPath, 'utf8').split('\n');
} catch {
  // .env.local doesn't exist yet — fine, created fresh below.
}

const preservedLines = existingLines.filter(
  (line) =>
    !line.startsWith('EXPO_PUBLIC_DEV_TEST_EMAIL=') &&
    !line.startsWith('EXPO_PUBLIC_DEV_TEST_PASSWORD=') &&
    line.trim() !== '',
);

preservedLines.push(
  `EXPO_PUBLIC_DEV_TEST_EMAIL=${TEST_EMAIL}`,
  `EXPO_PUBLIC_DEV_TEST_PASSWORD=${password}`,
);

writeFileSync(envLocalPath, preservedLines.join('\n') + '\n');

console.log(
  `Dev test account ready (${existingUserId ? 'password rotated' : 'created'}): ${TEST_EMAIL}`,
);
console.log('Credentials written to .env.local — restart Metro to pick them up.');
