// @ts-check
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  eslintConfigPrettier,
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
    ],
  },
];
