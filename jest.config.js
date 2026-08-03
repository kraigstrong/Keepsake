// Split into two Jest projects rather than one shared config: jest-expo's
// preset ships a React-Native-flavored test environment (@react-native/
// jest-preset's react-native-env.js) that mocks/polyfills globals like
// fetch in ways that break real outbound HTTP — fine for RN component/
// logic tests, but it silently broke the first live Anthropic API call
// in server/ai/extractRecipe.test.ts with a bare "Connection error." and
// no useful stack. Server-side code needs plain Node networking.
const jestExpoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: ['**/*.{ts,tsx}', '!**/coverage/**', '!**/node_modules/**', '!**/.expo/**'],
  projects: [
    {
      ...jestExpoPreset,
      displayName: 'app',
      rootDir: __dirname,
      // Deliberately excludes app/**/*.test.{ts,tsx}: Expo Router's context
      // scanner treats every file under app/ as a candidate route, so a
      // colocated test file would pollute the real route tree. Route/nav
      // tests live under src/navigation/ instead, and use renderRouter's
      // context param to point back at app/.
      testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
      // Default 5000ms is too tight for renderRouter()-based navigation
      // tests under CI's slower/more variable runners — consistently fine
      // locally, but flaky-timed-out in CI once the tab bar started doing
      // real SVG rendering work (Phase 3.5). These tests wait on real
      // async settling (see the extensive comments in
      // src/navigation/navigation.test.tsx), not a fixed busy-loop, so a
      // bigger ceiling is the right fix, not a smaller one.
      testTimeout: 20000,
    },
    {
      ...jestExpoPreset,
      displayName: 'server',
      rootDir: __dirname,
      testEnvironment: 'node',
      // Drop jest-expo's RN-environment setup (native module mocks, the
      // fetch polyfill that broke real network calls) — server code
      // needs none of it and it's actively harmful here.
      setupFiles: [],
      testMatch: ['<rootDir>/server/**/*.test.ts'],
    },
  ],
};
