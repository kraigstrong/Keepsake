// Manual mock, applied automatically to every test (same root-level
// __mocks__ convention as @sentry/react-native.js and posthog-react-
// native.js). Without this, importing the real native module — which
// src/supabase/secureStore.ts does, and anything importing the Supabase
// client transitively pulls in — throws "native module not found" in
// the Jest environment. Re-exports the package's own official mock
// rather than reimplementing it.
module.exports = require('@react-native-async-storage/async-storage/jest');
