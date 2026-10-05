#!/usr/bin/env node
// CI dependency scan (.github/workflows/ci.yml's "Dependency scan"
// job). Runs `npm audit --omit=dev` itself and fails on any high/
// critical advisory that isn't in the reviewed advisory allowlist
// below — narrower than a blanket `--audit-level` drop, which would
// silently swallow *any* future high-severity finding, not just the
// specific advisories reviewed below.
//
// Usage: node scripts/check-npm-audit.mjs

import { execSync } from 'node:child_process';

// Each entry is a root package `npm audit` flags directly (i.e. it has
// a real advisory attached, not just "depends on a vulnerable version
// of X" from being somewhere in the dependency chain) — reviewed and
// accepted because these specific flaws are not reachable by input to the
// shipped app or server:
//
// - image-size (high, GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq): only
//   reached via expo -> @expo/metro -> metro -> image-size — Metro's
//   own build-time bundler, processing this repo's own known asset
//   files during `expo start`/`expo run:ios`, never a user-supplied or
//   network-delivered file.
// - nanoid (high, GHSA-2v37-7h3g-55p8, "custom generators can loop
//   indefinitely when size is zero"): only reached via expo-router's
//   own internal ID generation and postcss (a build-time CSS
//   processor); this app never calls nanoid directly, so there's no
//   path for it to be invoked with the size=0 that triggers the bug.
//
// - braces (high, GHSA-vfj7-8cjw-p6xm): Metro file watchers use
//   micromatch -> braces for developer-configured glob patterns, not
//   recipe content, uploaded images, or imported URLs. Jest also uses
//   it for local test-file matching. No patched release as of 2026-10-04.
// - node-forge (high, GHSA-86w9-cpqp-85rv): only pulled in by @expo/cli
//   and @expo/code-signing-certificates for development/build signing.
//   The app and Edge Functions do not import it. This exception does
//   not cover tooling processing untrusted certificates or signatures;
//   revisit before enabling that workflow. No patched release as of
//   2026-10-04.
//
// Re-run without this allowlist periodically (or watch for
// `npm audit fix` proposing a non-breaking upgrade) to see whether
// any has a real fix upstream yet.
const ALLOWLISTED_ADVISORIES = {
  'image-size': ['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'],
  nanoid: ['GHSA-2v37-7h3g-55p8'],
  braces: ['GHSA-vfj7-8cjw-p6xm'],
  'node-forge': ['GHSA-86w9-cpqp-85rv'],
};

function runAudit() {
  try {
    return execSync('npm audit --omit=dev --json', { encoding: 'utf8' });
  } catch (error) {
    // npm audit exits non-zero when it finds anything — the JSON we
    // want is still on stdout either way.
    return error.stdout;
  }
}

const report = JSON.parse(runAudit());
const vulnerabilities = report.vulnerabilities ?? {};

const flagged = [];
const allowlisted = [];

for (const [name, info] of Object.entries(vulnerabilities)) {
  if (info.severity !== 'high' && info.severity !== 'critical') continue;

  // A pure chain entry ("depends on vulnerable versions of X") has no
  // advisory object of its own in `via` — only strings naming the next
  // package down the chain. Only a package with a real advisory
  // attached is a root cause worth allowlisting or failing on.
  const advisories = info.via.filter((entry) => typeof entry === 'object');
  if (advisories.length === 0) continue;

  for (const advisory of advisories) {
    const accepted = (ALLOWLISTED_ADVISORIES[name] ?? []).some(
      (id) => advisory.url === `https://github.com/advisories/${id}`,
    );
    const target = accepted ? allowlisted : flagged;
    target.push({ name, severity: info.severity, advisories: [advisory] });
  }
}

if (allowlisted.length > 0) {
  console.log('Allowlisted (known, reviewed, not reachable by real input):');
  for (const { name, severity, advisories } of allowlisted) {
    for (const advisory of advisories) {
      console.log(`  ${name} (${severity}): ${advisory.title} — ${advisory.url}`);
    }
  }
  console.log('');
}

if (flagged.length > 0) {
  console.error('New high/critical advisories not in the allowlist:\n');
  for (const { name, severity, advisories } of flagged) {
    for (const advisory of advisories) {
      console.error(`  ${name} (${severity}): ${advisory.title} — ${advisory.url}`);
    }
  }
  console.error(
    "\nReview each one: if it's a real, reachable risk, fix it (or note why it can't be " +
      "fixed yet). If it's build-tooling-only like the existing allowlist entries, add it to " +
      'ALLOWLISTED_ADVISORIES in scripts/check-npm-audit.mjs with the same reasoning.',
  );
  process.exit(1);
}

console.log('No new high/critical advisories outside the reviewed allowlist. OK.');
