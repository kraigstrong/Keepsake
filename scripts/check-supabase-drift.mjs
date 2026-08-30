#!/usr/bin/env node
// Compares the hosted Supabase project against what this repo declares,
// and reports anything that disagrees.
//
// Why this exists: local-vs-hosted disagreement has caused three separate
// incidents, each invisible until something specific went looking, and
// each time the docs described local state as if it were reality.
//
//   2026-08-18  the magic-link failure included a stale site_url and an
//               otp_length mismatch (docs/history/cross-cutting-otp-email-fix.md)
//   2026-08-29  password_min_length was 6 on the hosted project while
//               docs/threat-model.md T11 claimed 8
//   2026-08-29  two migrations had never been applied to staging, one of
//               them the fix behind a beta gate docs/current.md recorded
//               as closed
//
// Two different failure modes, deliberately checked separately:
//
//   DECLARED drift — config.toml's [remotes.staging] block says one thing
//   and the live project says another. `supabase config push` fixes these.
//
//   UNDECLARED settings — a value nobody ever told the project about, so
//   it sits at whatever Supabase defaults to. This is what password_min_
//   length actually was: not a value that drifted from an intention, but
//   an intention that was never expressed. `config push` cannot help,
//   because there is nothing to push. These are asserted here instead,
//   each with the reason it matters, and the fix is to add them to
//   [remotes.staging.auth] so they become declared.
//
// Usage: node scripts/check-supabase-drift.mjs
// Needs the Keepsake Dev Tools 1Password Environment mounted (devtools.env).
// Never prints a credential.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(rootDir, 'supabase', 'config.toml');
const DEVTOOLS_ENV = path.join(rootDir, 'devtools.env');

// config.toml key (within [remotes.staging...]) -> Management API field.
// Only settings whose local and hosted values are meant to be identical.
// Ports, container settings and the local [auth] block are deliberately
// absent: those are supposed to differ, and comparing them would produce
// noise that trains you to ignore this script.
const DECLARED = [
  { section: 'remotes.staging.auth', key: 'site_url', api: 'site_url' },
  { section: 'remotes.staging.auth.rate_limit', key: 'email_sent', api: 'rate_limit_email_sent' },
  {
    section: 'remotes.staging.auth',
    key: 'minimum_password_length',
    api: 'password_min_length',
  },
  { section: 'remotes.staging.auth.email.smtp', key: 'host', api: 'smtp_host' },
];

// Settings with no declaration to compare against, asserted directly.
// Each carries why it matters, because a bare expected value invites
// someone to "fix" the assertion rather than the project.
const ASSERTED = [
  {
    api: 'security_update_password_require_reauthentication',
    expected: false,
    why: 'ADR-0012 sets a password from Settings via updateUser(); enabling this breaks that path',
  },
  {
    api: 'external_anonymous_users_enabled',
    expected: false,
    why: 'anonymous sign-ins would bypass the email-ownership proof OTP provides',
  },
  {
    api: 'security_manual_linking_enabled',
    expected: false,
    why: 'identity linking is not part of this app’s auth model (ADR-0008)',
  },
  {
    api: 'mailer_otp_length',
    expected: 6,
    why: 'SignInScreen’s code entry and the email templates both assume 6 digits',
  },
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * Minimal TOML reader for the specific keys above — Node has no built-in
 * TOML parser and this does not justify a dependency. Handles exactly
 * `[section]` headers and `key = value` lines; no arrays, no inline
 * tables, no multi-line strings. If config.toml ever grows a shape this
 * cannot read, the value comes back undefined and is reported as
 * "not declared" rather than silently passing.
 */
function readToml(contents) {
  const out = new Map();
  let section = '';
  for (const raw of contents.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    let value = kv[2].replace(/\s+#.*$/, '').trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    out.set(`${section}.${kv[1]}`, value);
  }
  return out;
}

function loadProjectRef() {
  if (!existsSync(DEVTOOLS_ENV)) {
    fail(
      'devtools.env is not present. It is a 1Password Environment mount, not a\n' +
        '  file in the repo — open 1Password and confirm Keepsake Dev Tools is mounted.',
    );
  }
  // A FIFO: a plain readFileSync blocks forever when nothing is serving it.
  // Captured to a buffer, never to stdout (docs/deploying-edge-functions.md).
  let contents;
  try {
    contents = execFileSync('cat', [DEVTOOLS_ENV], { encoding: 'utf8', timeout: 10_000 });
  } catch {
    fail('Could not read devtools.env within 10s. Is 1Password running and the mount active?');
  }
  const env = {};
  for (const line of contents.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    fail('devtools.env is missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF.');
  }
  // Known gotcha: this has been stored as a full URL before.
  const ref = env.SUPABASE_PROJECT_REF.replace(/^https:\/\//, '').replace(/\.supabase\.co$/, '');
  return { token: env.SUPABASE_ACCESS_TOKEN, ref };
}

const { token, ref } = loadProjectRef();
const toml = readToml(readFileSync(CONFIG, 'utf8'));

// This script exists to prevent false greens, so it must not be capable of
// producing one itself. devtools.env is a 1Password mount that could point
// at a different or stale project; without this, the check would validate
// whatever that ref names and report success while staging went unexamined.
// config.toml already declares which project [remotes.staging] describes,
// so there is something authoritative to compare against.
const declaredRef = toml.get('remotes.staging.project_id');
if (!declaredRef) {
  fail(
    '[remotes.staging] has no project_id, so there is nothing to verify the credentials against.',
  );
}
if (declaredRef !== ref) {
  fail(
    `devtools.env points at project "${ref}", but [remotes.staging] declares\n` +
      `  "${declaredRef}". Refusing to check a project this repo does not describe —\n` +
      `  a green result here would say nothing about staging.`,
  );
}

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  fail(`Management API returned ${response.status} reading the auth config.`);
}
const live = await response.json();

const problems = [];

for (const { section, key, api } of DECLARED) {
  const declared = toml.get(`${section}.${key}`);
  if (declared === undefined) {
    problems.push(`  ${api}: not declared in [${section}] — hosted value is ${live[api]}`);
    continue;
  }
  // env(...) placeholders resolve at push time; nothing to compare here.
  if (typeof declared === 'string' && declared.startsWith('env(')) continue;
  if (live[api] !== declared) {
    problems.push(
      `  ${api}: config.toml says ${JSON.stringify(declared)}, project has ${JSON.stringify(live[api])}`,
    );
  }
}

for (const { api, expected, why } of ASSERTED) {
  if (live[api] !== expected) {
    problems.push(
      `  ${api}: expected ${JSON.stringify(expected)}, project has ${JSON.stringify(live[api])}\n      ${why}`,
    );
  }
}

// Migrations: the third incident, and the one config push cannot see.
// Both directions are drift. A local-only migration means the project is
// missing a change the repo has — the 2026-08-29 case. A remote-only one
// means the project has a change the repo does not, which matters more
// here than it might elsewhere: migrations are forward-only (AGENTS.md),
// so there is no mechanism that would legitimately produce one, and its
// existence means something was applied out of band or a file was lost.
let localOnly = [];
let remoteOnly = [];
try {
  const raw = execFileSync(
    'npx',
    ['supabase', 'migration', 'list', '--project-ref', ref, '--output-format', 'json'],
    { encoding: 'utf8', timeout: 120_000, env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } },
  );
  const line = raw
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .pop();
  const rows = JSON.parse(line).migrations ?? [];
  localOnly = rows.filter((m) => m.local && !m.remote).map((m) => m.local);
  remoteOnly = rows.filter((m) => m.remote && !m.local).map((m) => m.remote);
} catch {
  problems.push('  migrations: could not be listed — check the CLI and credentials');
}
for (const m of localOnly) {
  problems.push(`  migration ${m} exists locally but has never been applied to the project`);
}
for (const m of remoteOnly) {
  problems.push(
    `  migration ${m} is applied on the project but does not exist in this repo —\n` +
      `      applied out of band, or the file was lost; migrations are forward-only`,
  );
}

if (problems.length > 0) {
  console.error('\nHosted project disagrees with this repo:\n');
  for (const p of problems) console.error(p);
  console.error(
    '\nDeclared mismatches: `npx supabase config push`. Undeclared settings: add them\n' +
      'to [remotes.staging.auth] so they are reproducible, then push. Unapplied\n' +
      'migrations: `npx supabase db push`.\n',
  );
  process.exit(1);
}

console.log(
  `✓ Hosted project matches this repo — ${DECLARED.length} declared settings, ` +
    `${ASSERTED.length} asserted invariants, and no unapplied migrations.`,
);
