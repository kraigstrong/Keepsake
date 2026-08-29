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
import { existsSync, linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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

// Writing a clean .env.local does not *unset* anything: Expo loads a chain
// of dotenv files, and process.env beats all of them. So a forbidden name
// living in any of these is inlined regardless of what this script wrote —
// checking only the file it generated would be an assertion that passes
// while the thing it asserts is false. Names are the standard Expo chain;
// .env.example is absent deliberately, being a template Expo never loads.
const OTHER_ENV_FILES = [
  '.env',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
];

// Marks "there was no .env.local before this ran", so --restore removes the
// generated snapshot instead of failing and leaving it in place to be
// mistaken for a development environment by the next prepare.
const NO_PRIOR_ENV_SENTINEL = '#__KEEPSAKE_NO_PRIOR_ENV_LOCAL__\n';

/** Name -> raw value. Values are used only for emptiness checks, never logged. */
function parseAssignments(contents) {
  const entries = new Map();
  for (const line of contents.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) entries.set(match[1], match[2]);
  }
  return entries;
}

/** Variable names only. Values are never returned, logged, or stored. */
function names(contents) {
  return [...parseAssignments(contents).keys()];
}

/** dotenv treats "", '' and bare whitespace as empty — so does startup code. */
function isEmptyValue(raw) {
  const trimmed = raw.trim();
  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
      ? trimmed.slice(1, -1)
      : trimmed;
  return unquoted.trim().length === 0;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * The other two ways a forbidden name reaches the bundle, neither of which
 * writing .env.local affects.
 *
 * Scope, stated honestly: the process-environment check sees *this* Node
 * process's environment. Xcode's build phase inherits from however Xcode
 * itself was launched — from Dock or launchd, that is not this shell. So
 * this catches the common case (an exported var in the terminal you work
 * in) and cannot prove the absence of one in Xcode's. The durable answer
 * is that these vars are never exported at all; see the doc section.
 */
function assertNoForbiddenElsewhere() {
  const inProcessEnv = Object.keys(process.env).filter((name) => FORBIDDEN_PATTERN.test(name));
  if (inProcessEnv.length > 0) {
    fail(
      `Development credentials are set in this shell's environment, which\n` +
        `  overrides every dotenv file — writing a clean .env.local would not\n` +
        `  unset them:\n` +
        inProcessEnv.map((name) => `    ${name}`).join('\n') +
        `\n  Unset them and archive from a shell that never exported them.`,
    );
  }

  const inOtherFiles = [];
  for (const fileName of OTHER_ENV_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!existsSync(filePath)) continue;
    for (const name of names(readFileSync(filePath, 'utf8'))) {
      if (FORBIDDEN_PATTERN.test(name)) inOtherFiles.push(`${fileName}: ${name}`);
    }
  }
  if (inOtherFiles.length > 0) {
    fail(
      `Development credentials live in other dotenv files Expo also loads, so\n` +
        `  a clean .env.local does not keep them out of the bundle:\n` +
        inOtherFiles.map((entry) => `    ${entry}`).join('\n') +
        `\n  Remove them before archiving.`,
    );
  }
}

function restore() {
  if (!existsSync(BACKUP)) {
    fail(`No ${path.basename(BACKUP)} to restore from — nothing to undo.`);
  }

  // The no-prior-env case: there was nothing to put back, so restoring means
  // removing the snapshot. Leaving it would let the next prepare back it up
  // as though it were a development environment.
  if (readFileSync(BACKUP, 'utf8') === NO_PRIOR_ENV_SENTINEL) {
    if (existsSync(TARGET)) unlinkSync(TARGET);
    unlinkSync(BACKUP);
    console.log(`✓ Removed the archive .env.local. There was no development one to restore.`);
    return;
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

  // Present-but-empty passes a name check and fails at runtime: instance.ts
  // tests these for truthiness and throws, so the archive succeeds and the
  // app dies on launch — the same silent-success shape this script exists
  // to prevent.
  const sourceValues = parseAssignments(contents);
  const unusable = REQUIRED.filter(
    (name) => !sourceValues.has(name) || isEmptyValue(sourceValues.get(name)),
  );
  if (unusable.length > 0) {
    fail(
      `client.env is missing, or has empty values for, variables the app cannot\n` +
        `  start without (src/supabase/instance.ts throws on either):\n` +
        unusable.map((name) => `    ${name}`).join('\n'),
    );
  }

  assertNoForbiddenElsewhere();

  // Claim the backup slot atomically. The existsSync guard at the top of
  // this function is a friendly early exit, not the actual guarantee — two
  // overlapping runs both pass it, and a plain rename() would then let the
  // second overwrite the first's backup, destroying the real .env.local.
  //
  // link() and wx both fail with EEXIST rather than clobbering, so whoever
  // creates BACKUP first wins and the loser stops. link() also preserves
  // the target's contents, which matters for the crash windows: interrupted
  // between link and unlink leaves BACKUP and TARGET both holding the
  // development env (--restore recovers it), and interrupted after the
  // sentinel write leaves nothing to lose. No window destroys the original.
  const hadPriorEnvLocal = existsSync(TARGET);
  try {
    if (hadPriorEnvLocal) {
      linkSync(TARGET, BACKUP);
      unlinkSync(TARGET);
    } else {
      writeFileSync(BACKUP, NO_PRIOR_ENV_SENTINEL, { mode: 0o600, flag: 'wx' });
    }
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail(
        `${path.basename(BACKUP)} was created by another run while this one was\n` +
          `  working. Nothing was changed. Run with --restore once that run is done.`,
      );
    }
    throw error;
  }
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

  // Empty counts as absent here for the same reason it does for REQUIRED:
  // initPostHog and initSentry both short-circuit on a falsy key, so a blank
  // assignment is silently unobservable — precisely the case this warning
  // exists to surface, and the one a name-only check would sail past.
  const writtenValues = parseAssignments(readFileSync(TARGET, 'utf8'));
  const absent = EXPECTED.filter(
    (name) => !writtenValues.has(name) || isEmptyValue(writtenValues.get(name)),
  );
  if (absent.length > 0) {
    console.log(`\n⚠ Missing or empty — this build will be silently unobservable:`);
    for (const name of absent) console.log(`    ${name}`);
    console.log(`  Add them to the Keepsake Client environment if that is not deliberate.`);
  }

  console.log(
    hadPriorEnvLocal
      ? `\n  Your previous .env.local is at ${path.basename(BACKUP)}.` +
          `\n  Run \`npm run archive:env:restore\` when the archive is done.`
      : `\n  There was no .env.local before this ran, so restore will remove the` +
          `\n  snapshot rather than put one back. Still run \`npm run archive:env:restore\`.`,
  );
  console.log(
    `\n  This is a point-in-time snapshot: it goes stale if a value rotates in\n` +
      `  1Password. Re-run before each archive rather than trusting an old one.\n` +
      `\n  Scope: this asserts on dotenv files and this shell's environment. It\n` +
      `  cannot see the environment Xcode itself was launched with — archive\n` +
      `  from a shell that never exported EXPO_PUBLIC_DEV_TEST_*.`,
  );
}

if (process.argv.includes('--restore')) restore();
else prepare();
