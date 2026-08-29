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
// Two rules, both name-based: FORBIDDEN_NAMES must not appear in client
// code at all, and DEV_ONLY_NAMES may appear only in the one file that
// guards them (see that constant for why the distinction matters).
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

// Credential-bearing names that ARE read from client code on purpose, but
// from exactly one file. These are EXPO_PUBLIC_*, so babel inlines their
// values into the bundle at build time — the `__DEV__` guard in
// useDevAutoSignIn.ts makes the code path dead in a release build, but
// only that one file is reviewed for having the guard. A second reader is
// the realistic way a real staging password ends up live in a shipped
// bundle, so it fails here rather than in review.
//
// This does not cover the other half of the risk: these vars being SET at
// build time for a release build. There is no eas.json yet; when one
// lands, assert no build profile defines them (docs/release-checklist.md
// carries it manually until then).
const DEV_AUTO_SIGN_IN_FILES = [
  'src/session/useDevAutoSignIn.ts',
  'src/session/useDevAutoSignIn.test.ts',
];

const DEV_ONLY_NAMES = {
  EXPO_PUBLIC_DEV_TEST_EMAIL: DEV_AUTO_SIGN_IN_FILES,
  EXPO_PUBLIC_DEV_TEST_PASSWORD: DEV_AUTO_SIGN_IN_FILES,
};

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
    const relativePath = path.relative(rootDir, filePath);
    lines.forEach((line, index) => {
      for (const name of FORBIDDEN_NAMES) {
        if (line.includes(name)) {
          violations.push(`${relativePath}:${index + 1} references ${name}`);
        }
      }
      for (const [name, allowedPaths] of Object.entries(DEV_ONLY_NAMES)) {
        if (line.includes(name) && !allowedPaths.includes(relativePath)) {
          violations.push(
            `${relativePath}:${index + 1} references ${name}, which may only be read from ${allowedPaths.join(' or ')}`,
          );
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Server-only secret name(s) found in client bundle source (src/ or app/):\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(
    '\nServer-only names must be read server-side (server/, supabase/functions/) via' +
      '\nDeno.env.get / process.env, never from client code. A dev-only name is already' +
      '\nread from client code on purpose, but only from the one file reviewed for having' +
      '\na __DEV__ guard — add the guard there rather than a second reader here.',
  );
  process.exit(1);
}

console.log(`No server-only secret names found in ${CLIENT_DIRS.join('/, ')}/. OK.`);
