import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-npm-audit.mjs', import.meta.url));

function check(advisories, severity = 'high', name = 'image-size') {
  const directory = mkdtempSync(join(tmpdir(), 'keepsake-audit-test-'));
  try {
    // Exercise the real command, replacing only npm's network response.
    const report = { vulnerabilities: { [name]: { severity, via: advisories } } };
    writeFileSync(
      join(directory, 'npm'),
      '#!/bin/sh\nprintf "%s" "$KEEPSAKE_TEST_AUDIT_REPORT"\nexit 1\n',
      { mode: 0o700 },
    );
    return spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        KEEPSAKE_TEST_AUDIT_REPORT: JSON.stringify(report),
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const advisory = (id) => ({ title: id, url: `https://github.com/advisories/${id}` });

test('accepts only the reviewed tooling advisories', () => {
  for (const [name, id] of [
    ['image-size', 'GHSA-w3rx-r6r6-pgpr'],
    ['image-size', 'GHSA-5p2g-fcmc-qvqq'],
    ['nanoid', 'GHSA-2v37-7h3g-55p8'],
    ['braces', 'GHSA-vfj7-8cjw-p6xm'],
    ['node-forge', 'GHSA-86w9-cpqp-85rv'],
  ]) {
    assert.equal(check([advisory(id)], 'high', name).status, 0);
  }
});

test('fails on a future advisory even when that package has an accepted advisory', () => {
  const result = check([advisory('GHSA-w3rx-r6r6-pgpr'), advisory('GHSA-new-risk')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GHSA-new-risk/);
});

test('fails on new critical advisories and does not transfer exceptions between packages', () => {
  assert.equal(check([advisory('GHSA-new-risk')], 'critical', 'new-package').status, 1);
  assert.equal(check([advisory('GHSA-w3rx-r6r6-pgpr')], 'high', 'new-package').status, 1);
});
