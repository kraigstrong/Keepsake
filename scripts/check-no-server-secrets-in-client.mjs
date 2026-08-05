#!/usr/bin/env node
// CI check (execution-plan.md T2 / threat-model.md T2): fails if a
// server-only secret name is referenced anywhere under src/ or app/ —
// the directories that actually ship in the Expo/RN client bundle.
// Deferred since Phase 0 ("worth building before whichever phase first
// adds a real Edge Function" — docs/phase-status.md); Phase 8's
// import-recipe Edge Function is that phase, so ANTHROPIC_API_KEY
// leaking into the client bundle is now a live risk, not a hypothetical
// one.
//
// Deliberately a name-based grep, not a value-based scanner (gitleaks
// already owns "no secret value committed" — see .github/workflows/
// ci.yml's secret-scan job) — this catches the narrower, different
// mistake of a server-only *variable name* being read from client code,
// which would be a real bug even before any real value is ever set.
//
// Usage: node scripts/check-no-server-secrets-in-client.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keepsake Server 1Password Environment (see the keepsake-secrets-setup
// memory) — the app-runtime secrets a real Edge Function reads via
// Deno.env.get, never the client. SUPABASE_ACCESS_TOKEN/PROJECT_REF
// (Keepsake Dev Tools) are CLI-only credentials, not app-runtime
// secrets, and out of scope here.
const FORBIDDEN_NAMES = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_POSTGRES_PASSWORD',
];

const CLIENT_DIRS = ['src', 'app'];
const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      yield* walk(fullPath);
    } else if (SCANNABLE_EXTENSIONS.has(path.extname(entry))) {
      yield fullPath;
    }
  }
}

const violations = [];

for (const dir of CLIENT_DIRS) {
  const absoluteDir = path.join(rootDir, dir);
  for (const filePath of walk(absoluteDir)) {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const name of FORBIDDEN_NAMES) {
        if (line.includes(name)) {
          violations.push(`${path.relative(rootDir, filePath)}:${index + 1} references ${name}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Server-only secret name(s) found in client bundle source (src/ or app/):\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\nThese must only be read server-side (server/, supabase/functions/) via Deno.env.get / process.env, never from client code.',
  );
  process.exit(1);
}

console.log(`No server-only secret names found in ${CLIENT_DIRS.join('/, ')}/. OK.`);
