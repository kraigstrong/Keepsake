// Manual mock, applied automatically to every test (Jest convention for
// root-level __mocks__/<package> next to node_modules — no per-file
// jest.mock() needed). Without this, importing the real SDK — even
// without calling init() — leaves Jest workers unable to exit cleanly,
// since src/observability/sentry.ts (and anything that transitively
// imports it, e.g. the whole app/ tree via app/_layout.tsx) touches this
// package in every test run.
module.exports = {
  init: jest.fn(),
  captureException: jest.fn(),
};
