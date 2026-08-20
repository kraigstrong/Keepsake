// @ts-check
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  eslintConfigPrettier,
  {
    // Manual Jest mocks (node_modules/<pkg> convention) — not matched by
    // eslint-config-expo's own *.test.* jest-globals pattern.
    files: ['__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
      },
    },
  },
  {
    // sentry.ts/posthog.ts guard init with module-level state, so their
    // tests need a fresh module instance per test case (resetModules() +
    // dynamic require()) — a static top-level import would share that
    // state across every test in the file.
    files: ['src/observability/sentry.test.ts', 'src/observability/posthog.test.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    ignores: [
      'dist/*',
      'node_modules/*',
      '.expo/*',
      'coverage/*',
      '.claude/*',
      // CommonJS Node tooling configs, not app source — same treatment
      // as eslint.config.js itself (which flat config never lints).
      'jest.config.js',
      'babel.config.js',
      // Deno Edge Functions (Phase 8+, ADR-0015) — separate runtime, not
      // lintable by this Node/RN project's ESLint config. See
      // tsconfig.json's matching exclusion for the full reasoning.
      'supabase/functions/*',
      // Design-tool-generated reference material (docs/design/), not app
      // source — same treatment as the Deno exclusion above.
      'docs/design/**/*.js',
    ],
  },
];
