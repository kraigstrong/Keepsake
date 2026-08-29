#!/usr/bin/env node
// Prepares .env.local for a distribution archive, and restores your dev
// one afterward.
//
// Why this exists: babel-preset-expo inlines every EXPO_PUBLIC_* var into
// the bundle at build time, and the Xcode "Bundle React Native code and
// images" phase reads .env.local — a file you populate by hand, unlike
// client.env. So .env.local is where the EXPO_PUBLIC_ prefix stops being
// a guarantee about anything. Two failures follow from archiving with a
// day-to-day .env.local, and neither announces itself:
//
//   1. EXPO_PUBLIC_DEV_TEST_EMAIL/_PASSWORD (useDevAutoSignIn.ts's local
//      convenience, deliberately never in client.env) ship a working
//      staging password inside the app. The __DEV__ guard makes the code
//      path dead in a release build; it does nothing about the string
//      being present.
//   2. A .env.local predating the telemetry keys yields an archive where
//      trackEvent/logError are silent no-ops — discovered, at best, when
//      you go looking for events that were never sent.
//
// scripts/check-no-server-secrets-in-client.mjs catches a *second file*
// reading those dev vars. It cannot see an untracked .env.local, which is
// why this half stayed procedural — until there is an eas.json to assert
// against, this script is the assertion.
//
// Usage:
//   node scripts/prepare-archive-env.mjs             snapshot for archive
//   node scripts/prepare-archive-env.mjs --restore   put your dev env back
//
// Never prints a value — only variable names.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(rootDir, 'client.env');
const TARGET = path.join(rootDir, '.env.local');
const BACKUP = path.join(rootDir, '.env.local.bak');

// Must never reach a shipped bundle. Prefixed EXPO_PUBLIC_* like everything
// else here — that prefix is the mechanism that would ship them, not a
// statement that they are safe to ship.
const FORBIDDEN_PATTERN = /^EXPO_PUBLIC_DEV_TEST_/;

// The app cannot function without these.
const REQUIRED = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

// Absent, the build runs but is silently unobservable — a warning, not a
// hard failure, so a deliberate no-telemetry build is still possible.
const EXPECTED = ['EXPO_PUBLIC_POSTHOG_KEY', 'EXPO_PUBLIC_SENTRY_DSN'];

/** Variable names only. Values are never returned, logged, or stored. */
function names(contents) {
  return contents
    .split('\n')
    .map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1])
    .filter((name) => name !== undefined);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function restore() {
  if (!existsSync(BACKUP)) {
    fail(`No ${path.basename(BACKUP)} to restore from — nothing to undo.`);
  }
  if (existsSync(TARGET)) unlinkSync(TARGET);
  renameSync(BACKUP, TARGET);
  console.log(`✓ Restored your development .env.local. Variables present:`);
  for (const name of names(readFileSync(TARGET, 'utf8')).sort()) console.log(`    ${name}`);
}

function prepare() {
  // Refuse rather than clobber: running this twice would otherwise back up
  // the clean snapshot over the backup of your real dev env, losing the
  // dev credentials this script exists to set aside.
  if (existsSync(BACKUP)) {
    fail(
      `${path.basename(BACKUP)} already exists, so an archive env is probably already in place.\n` +
        `  Run with --restore first if you want to start over.`,
    );
  }

  if (!existsSync(SOURCE)) {
    fail(
      `client.env is not present. It is a 1Password Environment mount, not a\n` +
        `  file in the repo — open 1Password and confirm the Keepsake Client\n` +
        `  environment is mounted.`,
    );
  }

  // client.env is a FIFO served live by a 1Password background process, so
  // a plain readFileSync blocks indefinitely when nothing is serving it.
  // One `cat` under a timeout gets the same single consistent snapshot the
  // FIFO supports, and fails in seconds instead of hanging. Captured to a
  // buffer, never to stdout.
  let contents;
  try {
    contents = execFileSync('cat', [SOURCE], { encoding: 'utf8', timeout: 10_000 });
  } catch {
    fail(
      `Could not read client.env within 10s. It is a named pipe — if nothing is\n` +
        `  serving it, this hangs rather than erroring. Check that 1Password is\n` +
        `  running and the Keepsake Client environment is mounted.`,
    );
  }

  const sourceNames = names(contents);
  if (sourceNames.length === 0) {
    fail(`client.env produced no variables. Is the Keepsake Client environment mounted?`);
  }

  // Belt: client.env should never carry these, so their presence means the
  // Client/dev boundary itself has broken, not that the snapshot is wrong.
  const leaked = sourceNames.filter((name) => FORBIDDEN_PATTERN.test(name));
  if (leaked.length > 0) {
    fail(
      `client.env contains development credentials, which it never should:\n` +
        leaked.map((name) => `    ${name}`).join('\n') +
        `\n  Remove them from the Keepsake Client 1Password Environment before archiving.`,
    );
  }

  const missing = REQUIRED.filter((name) => !sourceNames.includes(name));
  if (missing.length > 0) {
    fail(
      `client.env is missing variables the app cannot start without:\n` +
        missing.map((name) => `    ${name}`).join('\n'),
    );
  }

  if (existsSync(TARGET)) renameSync(TARGET, BACKUP);
  writeFileSync(TARGET, contents, { mode: 0o600 });

  // Braces: verify what actually landed on disk, not what we believe we
  // wrote. This is the check that matters — everything above reasons about
  // the source, this one reads the artifact the archive will consume.
  const writtenNames = names(readFileSync(TARGET, 'utf8'));
  const stillForbidden = writtenNames.filter((name) => FORBIDDEN_PATTERN.test(name));
  if (stillForbidden.length > 0) {
    fail(`.env.local still contains ${stillForbidden.join(', ')} after writing. Do not archive.`);
  }

  console.log(`✓ .env.local snapshotted from client.env. Variables written:`);
  for (const name of writtenNames.sort()) console.log(`    ${name}`);

  const absent = EXPECTED.filter((name) => !writtenNames.includes(name));
  if (absent.length > 0) {
    console.log(`\n⚠ Not present — this build will be silently unobservable:`);
    for (const name of absent) console.log(`    ${name}`);
    console.log(`  Add them to the Keepsake Client environment if that is not deliberate.`);
  }

  if (existsSync(BACKUP)) {
    console.log(
      `\n  Your previous .env.local is at ${path.basename(BACKUP)}.` +
        `\n  Run \`node scripts/prepare-archive-env.mjs --restore\` when the archive is done.`,
    );
  }
  console.log(
    `\n  This is a point-in-time snapshot: it goes stale if a value rotates in\n` +
      `  1Password. Re-run before each archive rather than trusting an old one.`,
  );
}

if (process.argv.includes('--restore')) restore();
else prepare();
