#!/usr/bin/env node
/**
 * ADR-0028 permits exactly one Edge Function to use the service-role key.
 * An exception whose only guard is reviewer memory stops being an
 * exception within a release or two, so this is the guard.
 *
 * Deliberately not covered by check-no-server-secrets-in-client.mjs: that
 * one scans src/, app/ and modules/ for server-only names leaking toward
 * the client bundle, and points those names *at* supabase/functions/ as
 * where they legitimately live. Nothing looked inside.
 *
 * Scans every source file under each function, not just index.ts. An
 * earlier version opened the entry point alone, which an ordinary
 * refactor defeats: move the client construction into a lib/admin.ts and
 * the guard passes while the second privileged path ships.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const FUNCTIONS_DIR = 'supabase/functions';
const PERMITTED = 'delete-account';
const NEEDLE = 'SUPABASE_SERVICE_ROLE_KEY';

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`✗ ${FUNCTIONS_DIR} not found — run from the repo root.`);
  process.exit(1);
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.jsx'];

// Comments are stripped before anything is matched. This file's own
// docstring names both the key and the permitted call, and counting those
// makes the guard report two privileged calls where there is one -- a
// check that cries wolf about its own documentation gets muted.
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function* sourceFilesUnder(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFilesUnder(full);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      yield full;
    }
  }
}

const offenders = [];
const privilegedCalls = [];
let permittedFound = false;

for (const entry of readdirSync(FUNCTIONS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const functionDir = join(FUNCTIONS_DIR, entry.name);
  for (const file of sourceFilesUnder(functionDir)) {
    const source = withoutComments(readFileSync(file, 'utf8'));
    const where = relative(FUNCTIONS_DIR, file);

    // The two scans are independent on purpose. Gating the admin-call
    // scan on the key being in the *same* file is how the previous
    // version let a second privileged operation through: move it into a
    // helper that never names the key, leave deleteUser in the entry
    // point, and the count still came to one.
    if (source.includes(NEEDLE)) {
      if (entry.name === PERMITTED) permittedFound = true;
      else offenders.push(where);
    }

    if (entry.name === PERMITTED) {
      privilegedCalls.push(
        ...[...source.matchAll(/auth\s*\.\s*admin\s*\.\s*(\w+)/g)].map((match) => ({
          file: where,
          method: match[1],
        })),
      );
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `✗ ${NEEDLE} appears in an Edge Function that is not permitted to use it:\n` +
      offenders.map((n) => `    ${n}`).join('\n') +
      `\n\n  ADR-0028 scopes the service-role exception to '${PERMITTED}' alone, whose\n` +
      `  only privileged call is auth.admin.deleteUser(id) with id from a verified\n` +
      `  JWT. A second privileged path is a new operand and a new place to get its\n` +
      `  provenance wrong. If this is genuinely needed, it needs its own ADR first.`,
  );
  process.exit(1);
}

// A silent pass because the permitted function stopped using the key --
// or was renamed, or deleted -- would mean this check is guarding nothing.
if (!permittedFound) {
  console.error(
    `✗ ${NEEDLE} no longer appears anywhere under ${FUNCTIONS_DIR}/${PERMITTED}/.\n` +
      `  Either the deletion path changed shape, or this check is now watching\n` +
      `  a function that does not exist. Both need a look; neither is a pass.`,
  );
  process.exit(1);
}

// Where the key is read is only half the exception. ADR-0028 scopes it to
// exactly one operation, and a second privileged call is a second operand
// with its own provenance to get wrong -- so a later
// auth.admin.updateUserById() inside this same function must fail here
// too, not pass because the file was already on the allowlist.
const PERMITTED_ADMIN_METHOD = 'deleteUser';
const unexpected = privilegedCalls.filter((call) => call.method !== PERMITTED_ADMIN_METHOD);
if (unexpected.length > 0) {
  console.error(
    `✗ ${PERMITTED} performs a privileged operation other than auth.admin.${PERMITTED_ADMIN_METHOD}:\n` +
      unexpected.map((c) => `    ${c.file}: auth.admin.${c.method}`).join('\n') +
      '\n\n  ADR-0028 permits exactly one privileged call. Every additional one is a\n' +
      '  new operand and a new place to get its provenance wrong, which is what the\n' +
      '  exception was scoped to avoid. A second one needs its own ADR first.',
  );
  process.exit(1);
}

if (privilegedCalls.length !== 1) {
  console.error(
    `✗ Expected exactly one auth.admin.${PERMITTED_ADMIN_METHOD} call in ${PERMITTED}, found ${privilegedCalls.length}.\n` +
      '  Zero means this check is watching a function that no longer does what it\n' +
      '  guards; more than one means the single-operand argument no longer holds.',
  );
  process.exit(1);
}

console.log(
  `No unpermitted service-role use in ${FUNCTIONS_DIR}, and ${PERMITTED} performs exactly one privileged call. OK.`,
);
