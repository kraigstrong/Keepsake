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
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS_DIR = 'supabase/functions';
const PERMITTED = 'delete-account';
const NEEDLE = 'SUPABASE_SERVICE_ROLE_KEY';

if (!existsSync(FUNCTIONS_DIR)) {
  console.error(`✗ ${FUNCTIONS_DIR} not found — run from the repo root.`);
  process.exit(1);
}

const offenders = [];
let permittedFound = false;

for (const entry of readdirSync(FUNCTIONS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const indexPath = join(FUNCTIONS_DIR, entry.name, 'index.ts');
  if (!existsSync(indexPath)) continue;
  const source = readFileSync(indexPath, 'utf8');
  if (!source.includes(NEEDLE)) continue;
  if (entry.name === PERMITTED) {
    permittedFound = true;
    continue;
  }
  offenders.push(entry.name);
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
    `✗ ${NEEDLE} no longer appears in ${FUNCTIONS_DIR}/${PERMITTED}/index.ts.\n` +
      `  Either the deletion path changed shape, or this check is now watching\n` +
      `  a function that does not exist. Both need a look; neither is a pass.`,
  );
  process.exit(1);
}

console.log(`No unpermitted service-role use in ${FUNCTIONS_DIR}. OK.`);
