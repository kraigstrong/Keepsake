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
      // gesture-handler v3 needs its own jest mocks (configureRelations
      // etc. aren't on the default native-module automock) — see
      // https://docs.swmansion.com/react-native-gesture-handler/docs/guides/testing/
      setupFiles: [...jestExpoPreset.setupFiles, 'react-native-gesture-handler/jestSetup'],
      // Deliberately excludes app/**/*.test.{ts,tsx}: Expo Router's context
      // scanner treats every file under app/ as a candidate route, so a
      // colocated test file would pollute the real route tree. Route/nav
      // tests live under src/navigation/ instead, and use renderRouter's
      // context param to point back at app/.
      testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
      // jest-expo only auto-mocks official Expo SDK native modules —
      // AppGroupBridge is a project-local one (modules/app-group-bridge),
      // so any test rendering the real app tree needs a safe default or
      // it throws "Cannot find native module 'AppGroupBridge'" the moment
      // app/_layout.tsx pulls it in (via src/import/outboxEngine.ts,
      // ADR-0016). A test file's own explicit jest.mock() for this same
      // path still takes precedence over this mapping.
      moduleNameMapper: {
        '^.*/modules/app-group-bridge/src/AppGroupBridgeModule$':
          '<rootDir>/__mocks__/modules/app-group-bridge/AppGroupBridgeModule.ts',
      },
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
