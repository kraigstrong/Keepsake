#!/usr/bin/env node
// Dev-only guard for scripts/run-sim-pair.sh: fetches the bundle a local
// Metro is serving and refuses unless every Supabase URL baked into it is
// loopback and every dev sign-in is a seeded group-e2e account.
//
// It exists because the app reads its config from `expo/virtual/env`,
// which Expo fills from .env.local — the hosted project — even when the
// shell sets different values. A simulator served from such a bundle
// signs into the real project. Prints hosts and email domains only.
//
// Usage: node scripts/verify-sim-bundle.mjs <port>

const port = process.argv[2];
if (!port) {
  console.error('usage: verify-sim-bundle.mjs <port>');
  process.exit(2);
}

const response = await fetch(
  `http://127.0.0.1:${port}/node_modules/expo-router/entry.bundle?platform=ios&dev=true&minify=false`,
);
if (!response.ok) {
  console.error(`Metro on ${port} returned ${response.status}`);
  process.exit(1);
}
const bundle = await response.text();

function valuesOf(name) {
  const pattern = new RegExp(`"${name}"\\s*:\\s*(?:\\{[^}]*?value:\\s*)?"([^"]*)"`, 'g');
  return [...bundle.matchAll(pattern)].map((match) => match[1]);
}

const urls = valuesOf('EXPO_PUBLIC_SUPABASE_URL');
const emails = valuesOf('EXPO_PUBLIC_DEV_TEST_EMAIL');
const problems = [];
if (urls.length === 0) problems.push('no EXPO_PUBLIC_SUPABASE_URL found in the bundle');
for (const url of urls) {
  const { hostname } = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    problems.push(`Supabase URL points at ${hostname}`);
  }
}
for (const email of emails) {
  if (!email.endsWith('@group-e2e.test')) {
    problems.push(`dev sign-in uses an account at @${email.split('@')[1] ?? '?'}`);
  }
}

if (problems.length > 0) {
  console.error(`Refusing port ${port}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `Port ${port} verified: ${urls.length} Supabase URL(s), all loopback; sign-in ${emails.join(', ')}.`,
);
