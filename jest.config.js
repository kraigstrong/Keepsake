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
      testMatch: ['<rootDir>/App.test.tsx', '<rootDir>/src/**/*.test.{ts,tsx}'],
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
