// Manual mock, applied automatically to every test (same root-level
// __mocks__ convention as @sentry/react-native.js and async-storage.js).
// Without this, the real native module throws in the Jest environment
// (no device to report real connectivity from) — src/connectivity/
// ConnectivityProvider.tsx imports it, and app/_layout.tsx (and anything
// that renders the real app tree, e.g. src/navigation/*.test.tsx) pulls
// it in transitively. Re-exports the package's own official mock rather
// than reimplementing it.
module.exports = require('@react-native-community/netinfo/jest/netinfo-mock');
