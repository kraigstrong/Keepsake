#!/usr/bin/env node
// Everything that must happen between "main is where you want it" and
// clicking Product > Archive in Xcode, with the checks that catch the
// failures this repo has actually hit.
//
// It exists because each step fails quietly in its own way:
//   - a day-to-day .env.local ships a staging password and no telemetry
//     (scripts/prepare-archive-env.mjs)
//   - `pod install` exits non-zero while a piped command reports success
//     (docs/building-ios-locally.md, Trap 1)
//   - skipping prebuild after an app.json change gives a green archive
//     stamped with the old CFBundleVersion, rejected at upload after the
//     entire compile (Trap 2)
//
// So this verifies the generated artifacts rather than trusting that the
// commands it just ran did what they were supposed to.
//
// Usage: npm run archive:prep
// Stops before Xcode. Prints the remaining manual steps.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INFO_PLIST = path.join(rootDir, 'ios', 'Keepsake', 'Info.plist');
const ENTITLEMENTS = path.join(rootDir, 'ios', 'Keepsake', 'Keepsake.entitlements');

// CocoaPods 1.16.2 crashes on Homebrew Ruby 4.x unless the locale is
// forced (docs/building-ios-locally.md, Trap 1).
const UTF8 = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

function step(message) {
  console.log(`\n▸ ${message}`);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Runs a command, streaming output, and fails on a non-zero exit. */
function run(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      cwd: options.cwd ?? rootDir,
      stdio: 'inherit',
      env: { ...process.env, ...UTF8 },
    });
  } catch {
    fail(`\`${command} ${args.join(' ')}\` failed. Nothing further has run.`);
  }
}

function plistString(contents, key) {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(contents);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------

const appJson = JSON.parse(readFileSync(path.join(rootDir, 'app.json'), 'utf8'));
const expectedBuildNumber = appJson.expo?.ios?.buildNumber;
const expectedVersion = appJson.expo?.version;
if (!expectedBuildNumber) {
  fail(
    'app.json has no ios.buildNumber, so CFBundleVersion generates as "1".\n' +
      '  App Store Connect rejects a duplicate build number — set it before archiving.',
  );
}

// A dirty tree means the archive contains something no commit describes,
// and the tag pointing at this build would be a lie. Warn rather than
// block: sometimes that is deliberate.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' });
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: rootDir,
  encoding: 'utf8',
}).trim();

console.log(`Preparing an archive of ${expectedVersion} (${expectedBuildNumber}) from ${head}.`);
if (dirty.trim()) {
  console.log(
    '\n⚠ Working tree is not clean. The archive will include these uncommitted\n' +
      '  changes, and nothing in git will record what shipped:\n' +
      dirty
        .trimEnd()
        .split('\n')
        .map((l) => `      ${l}`)
        .join('\n'),
  );
}

step('Snapshotting client.env into .env.local (archive:env)');
run('node', [path.join(rootDir, 'scripts', 'prepare-archive-env.mjs')]);

step('Regenerating ios/ from app.json (expo prebuild)');
// Not --clean: that deletes ios/ including the signing and team settings
// configured in Xcode. Plain prebuild updates in place.
run('npx', ['expo', 'prebuild', '-p', 'ios']);

step('Installing pods');
run('npx', ['pod-install']);

step('Verifying the generated project matches app.json');
if (!existsSync(INFO_PLIST)) fail(`${INFO_PLIST} does not exist after prebuild.`);

const info = readFileSync(INFO_PLIST, 'utf8');
const problems = [];

// The check that would otherwise fail at upload, after the whole compile.
const actualBuildNumber = plistString(info, 'CFBundleVersion');
if (actualBuildNumber !== String(expectedBuildNumber)) {
  problems.push(
    `CFBundleVersion is "${actualBuildNumber}" but app.json says "${expectedBuildNumber}" — ` +
      `prebuild did not take, and App Store Connect will reject this as a duplicate.`,
  );
}
const actualVersion = plistString(info, 'CFBundleShortVersionString');
if (actualVersion !== expectedVersion) {
  problems.push(
    `CFBundleShortVersionString is "${actualVersion}", app.json says "${expectedVersion}".`,
  );
}

// Trap 2's real damage: prebuild silently not propagating app.json's
// native config produces a green archive missing entitlements or
// permission strings, which only shows up as a broken feature later.
for (const key of [
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSRemindersUsageDescription',
]) {
  if (!plistString(info, key)) problems.push(`${key} is missing from Info.plist.`);
}
if (!info.includes('keepsake'))
  problems.push('The keepsake:// URL scheme is missing from Info.plist.');

const appGroup = appJson.expo?.ios?.entitlements?.['com.apple.security.application-groups']?.[0];
if (appGroup) {
  if (!existsSync(ENTITLEMENTS)) {
    problems.push('Keepsake.entitlements does not exist — the Share Extension handoff will fail.');
  } else if (!readFileSync(ENTITLEMENTS, 'utf8').includes(appGroup)) {
    problems.push(`The app group ${appGroup} is missing from Keepsake.entitlements.`);
  }
}

if (problems.length > 0) {
  fail(
    'The generated project does not match app.json:\n' +
      problems.map((p) => `    ${p}`).join('\n') +
      '\n  Do not archive. `npm run archive:env:restore` first, then investigate.',
  );
}

console.log(`\n✓ Ready to archive ${expectedVersion} (${expectedBuildNumber}) from ${head}.`);
console.log(`
  In Xcode:
    1. Open ios/Keepsake.xcworkspace — the workspace, not the .xcodeproj.
    2. Re-check Signing & Capabilities on BOTH targets (Keepsake and
       ShareExtension). prebuild regenerates the project, which is where
       the team selection lives.
    3. Destination: Any iOS Device (arm64). Archive is greyed out with a
       simulator selected.
    4. Product > Archive, then Distribute App > App Store Connect > Upload.

  Afterwards, and don't skip it — local auto-sign-in stays off until you do:
    npm run archive:env:restore
`);
